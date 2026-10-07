// Backfills the additive IAP fields (lib/db.ts GooglePlayPurchaseRecord) onto Google Play purchase
// rows written before they existed:
//   purchaseTokenHash, boundAt, acknowledgementState, acknowledgementAttempts, lastSnapshotAt
//
//   node scripts/backfill-google-play-purchase-iap-fields.mjs --report
//   node scripts/backfill-google-play-purchase-iap-fields.mjs --confirm
//
// Nothing here is required for the app to run: readDb treats every one of these fields as optional,
// so an unmigrated file loads and behaves as before. The backfill only lets audit rows and the
// acknowledgement retry job work from the new fields uniformly.
//
// Derivations use ONLY what the row already holds, never a provider call:
//  - purchaseTokenHash        sha256 hex of the row's own purchaseToken
//  - boundAt                  the row's createdAt (the legacy row was bound when it was created)
//  - acknowledgementState     "acknowledged" if the legacy boolean is true, otherwise "pending"
//  - acknowledgementAttempts  0 (no attempt history exists for a legacy row)
//  - lastSnapshotAt           the row's updatedAt (the last time the row was refreshed)
// A field that is already set is NEVER overwritten, so re-running after a partial --confirm is safe
// and idempotent.
//
// Ownership (userId) and the purchase token are never changed. A row whose purchaseToken is missing
// or not a string is skipped and counted, never invented. Two rows sharing one token are reported:
// the datastore helper enforces one row per token, so a duplicate means pre-existing damage that a
// human should look at; this script does not resolve it.
//
// Safety: --report is read-only and prints counts only (no user id, no token, no hash). Dry run by
// default; nothing is written without --confirm. The db file is backed up to <db>.bak-<ts> first.
// Set GYM_DB_PATH to target a different db file (used by tests).

import { createHash } from "crypto";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { report: false, confirm: false };
  for (const a of argv) {
    if (a === "--report") out.report = true;
    else if (a === "--confirm") out.confirm = true;
    else fail(`Unknown argument "${a}".`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.report && args.confirm) fail("--report is read-only and cannot be combined with --confirm.");
if (!existsSync(DB_PATH)) fail(`Database not found at ${DB_PATH}.`);

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));
const rows = db.googlePlayPurchases ?? [];

const stats = { total: 0, updated: 0, alreadyComplete: 0, skippedNoToken: 0, duplicateTokens: 0, fieldsFilled: 0 };
const seenTokens = new Set();

for (const row of rows) {
  stats.total++;
  if (typeof row.purchaseToken !== "string" || row.purchaseToken === "") {
    stats.skippedNoToken++;
    continue;
  }
  if (seenTokens.has(row.purchaseToken)) stats.duplicateTokens++;
  seenTokens.add(row.purchaseToken);

  const before = stats.fieldsFilled;
  const fill = (key, value) => {
    if (row[key] === undefined) {
      row[key] = value;
      stats.fieldsFilled++;
    }
  };
  fill("purchaseTokenHash", createHash("sha256").update(row.purchaseToken).digest("hex"));
  fill("boundAt", row.createdAt ?? null);
  fill("acknowledgementState", row.acknowledged === true ? "acknowledged" : "pending");
  fill("acknowledgementAttempts", 0);
  fill("lastSnapshotAt", row.updatedAt ?? null);

  if (stats.fieldsFilled > before) stats.updated++;
  else stats.alreadyComplete++;
}

console.log(`\nGoogle Play purchase IAP-field backfill — ${args.confirm ? "APPLYING" : "DRY RUN"}\n`);
console.log(`purchases: ${stats.total} total, ${stats.alreadyComplete} already complete, ${stats.updated} to update`);
console.log(`  fields filled: ${stats.fieldsFilled}`);
if (stats.skippedNoToken > 0) console.log(`  skipped (no usable purchase token): ${stats.skippedNoToken}`);
if (stats.duplicateTokens > 0) {
  console.log(`\n${stats.duplicateTokens} row(s) share a purchase token with an earlier row. The datastore enforces one row per`);
  console.log(`token, so this is pre-existing damage. It is NOT resolved here. Review it manually.`);
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
