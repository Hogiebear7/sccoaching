// Remove specific webhook-recorded revenue events (e.g. test payments) from the
// Finance history. Revenue events are append-only in the app: there is no route
// or UI to delete them, so this is the deliberate, explicit way to do it.
//
//   node scripts/remove-revenue-events.mjs --list [--from 2026-08-05] [--to 2026-08-06]
//   node scripts/remove-revenue-events.mjs --ref <providerRef> [--ref <providerRef> ...] --expect-total-cents <n>
//   node scripts/remove-revenue-events.mjs --ref <providerRef> ... --expect-total-cents <n> --confirm
//
// Safety:
//  - --list is read-only and prints only event id, provider, provider ref,
//    amount and date — never a user id, name or email.
//  - Deletion needs explicit --ref values (the Stripe invoice / Revolut order
//    id shown in the Finances "reference" column). No date-range or "delete
//    all" mode exists.
//  - Every --ref must match EXACTLY one revenue event; any miss or ambiguity
//    aborts with nothing written. A ref that belongs to a pass purchase is
//    refused (this script only touches revenue events).
//  - --expect-total-cents must equal the sum of the selected events, so a
//    mistyped ref cannot silently remove the wrong amount.
//  - Dry run by default; nothing is written without --confirm. The db file is
//    backed up to <db>.bak-<ts> first. Only revenueEvents entries are removed.
// Set GYM_DB_PATH to target a different db file (used by tests). Run against
// production only deliberately, from the deployed host, in a quiet window.

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { list: false, confirm: false, refs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") out.list = true;
    else if (a === "--confirm") out.confirm = true;
    else if (a === "--ref") out.refs.push(argv[++i] ?? "");
    else if (a === "--from") out.from = argv[++i];
    else if (a === "--to") out.to = argv[++i];
    else if (a === "--expect-total-cents") out.expectTotal = argv[++i];
    else fail(`Unknown argument "${a}".`);
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const money = (e) => `${(e.amountCents / 100).toFixed(2)} ${(e.currency ?? "").toUpperCase()}`;
const line = (e) => `  ${e.id}  ${e.provider}  ${e.providerRef}  ${money(e)}  ${String(e.receivedAt).slice(0, 10)}`;

const args = parseArgs(process.argv.slice(2));
if (!existsSync(DB_PATH)) fail(`Database not found at ${DB_PATH}.`);

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));
const events = db.revenueEvents ?? [];

if (args.list) {
  if (args.refs.length || args.expectTotal !== undefined || args.confirm) fail("--list is read-only and cannot be combined with --ref, --expect-total-cents or --confirm.");
  for (const [flag, value] of [["--from", args.from], ["--to", args.to]]) {
    if (value !== undefined && !DATE_RE.test(value)) fail(`${flag} must be a date like 2026-08-05.`);
  }
  const shown = events.filter((e) => {
    const day = String(e.receivedAt).slice(0, 10);
    return (!args.from || day >= args.from) && (!args.to || day <= args.to);
  });
  console.log(`\nRevenue events${args.from || args.to ? ` (${args.from ?? "…"} to ${args.to ?? "…"})` : ""}: ${shown.length}\n`);
  for (const e of shown) console.log(line(e));
  console.log(`\nTotal: ${(shown.reduce((s, e) => s + e.amountCents, 0) / 100).toFixed(2)}\nNothing written.\n`);
  process.exit(0);
}

const refs = args.refs.map((r) => r.trim());
if (refs.length === 0 || refs.some((r) => !r)) fail("Provide one or more --ref <providerRef>. (Use --list to see them.) No event is ever chosen automatically.");
if (new Set(refs).size !== refs.length) fail("Duplicate --ref values.");
if (!/^\d+$/.test(args.expectTotal ?? "")) fail("Provide --expect-total-cents <whole number of cents> equal to the total you intend to remove.");
const expectTotal = Number(args.expectTotal);

const purchases = db.purchases ?? [];
const selected = [];
for (const ref of refs) {
  const hits = events.filter((e) => e.providerRef === ref);
  if (hits.length === 0) {
    const isPurchase = purchases.some((p) => p.providerPaymentRef === ref || p.providerOrderId === ref);
    fail(isPurchase ? `"${ref}" is a pass purchase, not a revenue event. This script does not remove purchases.` : `No revenue event has reference "${ref}". Nothing removed.`);
  }
  if (hits.length > 1) fail(`${hits.length} revenue events share reference "${ref}" — refusing to guess. Nothing removed.`);
  selected.push(hits[0]);
}

const total = selected.reduce((s, e) => s + e.amountCents, 0);
if (total !== expectTotal) fail(`Selected events total ${total} cents but --expect-total-cents is ${expectTotal}. Nothing removed.`);

console.log(`\nRemove revenue events — ${args.confirm ? "APPLYING" : "DRY RUN"}\n`);
for (const e of selected) console.log(line(e));
console.log(`\n  ${selected.length} event${selected.length === 1 ? "" : "s"}, total ${(total / 100).toFixed(2)}`);

if (!args.confirm) {
  console.log(`\nNothing written. Re-run with --confirm to apply.\n`);
  process.exit(0);
}

const backup = `${DB_PATH}.bak-${Date.now()}`;
copyFileSync(DB_PATH, backup);

const drop = new Set(selected.map((e) => e.id));
db.revenueEvents = events.filter((e) => !drop.has(e.id));
writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

console.log(`\n✓ Removed ${selected.length} revenue event${selected.length === 1 ? "" : "s"}.`);
console.log(`  Backup written: ${backup}\n`);
