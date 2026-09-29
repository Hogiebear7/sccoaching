// Backfills MoneyRecordOwnerGym (lib/db.ts) onto money records written
// before that field existed: purchases, paymentEvents, passLedger,
// financeLedgerEntries. See the "Security: persist gym ownership on
// commerce and finance records" PR for the full design.
//
//   node scripts/backfill-money-record-owner-gym.mjs --report
//   node scripts/backfill-money-record-owner-gym.mjs --confirm
//
// Ownership is derived ONLY from authoritative existing relationships —
// never guessed, never defaulted to the primary gym just because there is
// currently one gym:
//  - purchases: productId -> membershipPackages -> deliveryChannel/category,
//    the SAME resolution the checkout route itself uses. A productId that no
//    longer resolves to a package (a historical/legacy row) is left
//    "unresolved" rather than guessed.
//  - passLedger: a purchase-provenance entry (purchase, refund_reversal)
//    inherits the now-migrated purchase's ownerGym. A booking-provenance
//    entry (consume, consume_reversal, staff_adjust) is derived from the
//    entry's own userId's CURRENT gym — the same live lookup the runtime
//    code performs, not a guess.
//  - paymentEvents: left "unresolved" unconditionally. These are pure
//    webhook dedupe/audit rows — replaying which purchase or subscription
//    produced a historical event from its entityId alone is exactly the
//    kind of inference this migration refuses to do. They never drive an
//    entitlement decision, so "unresolved" costs nothing functionally.
//  - financeLedgerEntries: a memberId-linked row is derived from that
//    member's CURRENT gym (live lookup). A memberless row (rent, payroll,
//    software, or any other business-wide entry) is left "unresolved" —
//    whether historical memberless rows are platform-wide or should be
//    attributed to a specific gym is exactly the policy decision this
//    migration will not make silently. An owner who wants to mark the
//    unresolved-and-memberless rows platform-wide can do so explicitly with
//    --finance-unresolved-to-platform (a separate, named, opt-in flag — see
//    below), never as this script's default behavior.
//
// Every record keeps whatever it already had — this migration only fills in
// rows where ownerGym is currently absent (undefined). Re-running it after
// a partial --confirm is safe and idempotent: already-migrated rows are
// skipped.
//
// Safety: --report is read-only and prints counts only (no user id, name,
// email, or amount). Dry run by default; nothing is written without
// --confirm. The db file is backed up to <db>.bak-<ts> first.
// Set GYM_DB_PATH to target a different db file (used by tests).

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { report: false, confirm: false, financeUnresolvedToPlatform: false };
  for (const a of argv) {
    if (a === "--report") out.report = true;
    else if (a === "--confirm") out.confirm = true;
    else if (a === "--finance-unresolved-to-platform") out.financeUnresolvedToPlatform = true;
    else fail(`Unknown argument "${a}".`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.report && (args.confirm || args.financeUnresolvedToPlatform)) {
  fail("--report is read-only and cannot be combined with --confirm or --finance-unresolved-to-platform.");
}
if (!existsSync(DB_PATH)) fail(`Database not found at ${DB_PATH}.`);

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));

const packagesById = new Map((db.membershipPackages ?? []).map((p) => [p.id, p]));
const categoriesById = new Map((db.membershipCategories ?? []).map((c) => [c.id, c]));
const usersById = new Map((db.users ?? []).map((u) => [u.id, u]));

function ownerGymForPackageId(productId) {
  const pkg = packagesById.get(productId);
  if (!pkg) return { scope: "unresolved" };
  if (pkg.deliveryChannel === "app_only") return { scope: "platform" };
  const category = categoriesById.get(pkg.categoryId);
  if (!category) return { scope: "unresolved" };
  return { scope: "gym", gymId: category.gymId ?? null };
}

function ownerGymForUserId(userId) {
  const user = usersById.get(userId);
  if (!user) return { scope: "unresolved" };
  return { scope: "gym", gymId: user.gymId ?? null };
}

const stats = {
  purchases: { total: 0, alreadySet: 0, gym: 0, platform: 0, unresolved: 0 },
  paymentEvents: { total: 0, alreadySet: 0, unresolved: 0 },
  passLedger: { total: 0, alreadySet: 0, gym: 0, platform: 0, unresolved: 0 },
  financeLedgerEntries: { total: 0, alreadySet: 0, gym: 0, platform: 0, unresolved: 0 },
};

// ── purchases ──────────────────────────────────────────────────────────
const purchasesById = new Map();
for (const p of db.purchases ?? []) {
  stats.purchases.total++;
  if (p.ownerGym !== undefined) {
    stats.purchases.alreadySet++;
  } else {
    p.ownerGym = ownerGymForPackageId(p.productId);
    stats.purchases[p.ownerGym.scope === "gym" ? "gym" : p.ownerGym.scope]++;
  }
  purchasesById.set(p.id, p);
}

// ── passLedger ─────────────────────────────────────────────────────────
for (const e of db.passLedger ?? []) {
  stats.passLedger.total++;
  if (e.ownerGym !== undefined) {
    stats.passLedger.alreadySet++;
    continue;
  }
  if ((e.reason === "purchase" || e.reason === "refund_reversal") && e.purchaseId) {
    const purchase = purchasesById.get(e.purchaseId);
    e.ownerGym = purchase?.ownerGym ?? { scope: "unresolved" };
  } else {
    // consume, consume_reversal, staff_adjust — the acting member's own
    // current gym, same live derivation the runtime code performs.
    e.ownerGym = ownerGymForUserId(e.userId);
  }
  stats.passLedger[e.ownerGym.scope === "gym" ? "gym" : e.ownerGym.scope]++;
}

// ── paymentEvents ──────────────────────────────────────────────────────
for (const ev of db.paymentEvents ?? []) {
  stats.paymentEvents.total++;
  if (ev.ownerGym !== undefined) {
    stats.paymentEvents.alreadySet++;
    continue;
  }
  ev.ownerGym = { scope: "unresolved" };
  stats.paymentEvents.unresolved++;
}

// ── financeLedgerEntries ───────────────────────────────────────────────
for (const entry of db.financeLedgerEntries ?? []) {
  stats.financeLedgerEntries.total++;
  if (entry.ownerGym !== undefined) {
    stats.financeLedgerEntries.alreadySet++;
    continue;
  }
  if (entry.memberId) {
    entry.ownerGym = ownerGymForUserId(entry.memberId);
  } else if (args.financeUnresolvedToPlatform) {
    entry.ownerGym = { scope: "platform" };
  } else {
    entry.ownerGym = { scope: "unresolved" };
  }
  stats.financeLedgerEntries[entry.ownerGym.scope === "gym" ? "gym" : entry.ownerGym.scope]++;
}

console.log(`\nMoney-record ownerGym backfill — ${args.confirm ? "APPLYING" : "DRY RUN"}\n`);
for (const [name, s] of Object.entries(stats)) {
  console.log(`${name}: ${s.total} total, ${s.alreadySet} already set`);
  console.log(
    `  newly resolved: gym=${s.gym ?? 0} platform=${s.platform ?? 0} unresolved=${s.unresolved}`
  );
}
const totalUnresolved = Object.values(stats).reduce((sum, s) => sum + s.unresolved, 0);
if (totalUnresolved > 0) {
  console.log(
    `\n${totalUnresolved} record(s) could not be resolved to a gym or platform scope and are marked "unresolved".`
  );
  console.log(
    `This is expected for legacy/removed-product purchases, all paymentEvents (see script header), and`
  );
  console.log(
    `memberless Finance entries unless --finance-unresolved-to-platform was passed. Review "unresolved" rows`
  );
  console.log(`manually before relying on gym-filtered Finance reporting.`);
}

if (args.report) {
  console.log(`\nNothing written (--report).\n`);
  process.exit(0);
}
if (!args.confirm) {
  console.log(`\nNothing written. Re-run with --confirm to apply.\n`);
  process.exit(0);
}

const backup = `${DB_PATH}.bak-${Date.now()}`;
copyFileSync(DB_PATH, backup);
writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

console.log(`\n✓ Backfill applied.`);
console.log(`  Backup written: ${backup}\n`);
