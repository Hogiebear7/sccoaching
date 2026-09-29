// Backfills SubscriptionRecord.ownerGym (lib/db.ts) onto subscription rows
// written before that field existed. Same discriminated ownership shape and
// same conventions as scripts/backfill-money-record-owner-gym.mjs (PR #49) —
// see that script's own header for the shared design rationale.
//
//   node scripts/backfill-subscription-owner-gym.mjs --report
//   node scripts/backfill-subscription-owner-gym.mjs --confirm
//
// Ownership is derived ONLY from authoritative existing relationships —
// never guessed, never defaulted to the primary gym just because there is
// currently one gym:
//  - packageId -> membershipPackages -> deliveryChannel/category, the SAME
//    resolution the checkout route and tier-grant use to AUTHORIZE the
//    subscription in the first place — never re-derived from the user's
//    CURRENT gym, because ownerGym is meant to be immutable historical
//    provenance (see SubscriptionRecord.ownerGym's own comment in lib/db.ts)
//    and a user's gym could, in a hypothetical future, no longer match the
//    gym they originally subscribed under.
//  - a subscription whose packageId no longer resolves to a package (a
//    legacy/removed product) is left "unresolved" rather than guessed.
//  - a subscription with no packageId at all (packageId: null — never
//    actually possible for an active/pending subscription in current code,
//    but the field is nullable) is also left "unresolved" rather than
//    falling back to the user's own gym, for the same immutability reason
//    the money-record script gives for not treating "the user's current
//    gym" as automatically authoritative for a historical record.
//
// Every record keeps whatever it already had — this migration only fills in
// rows where ownerGym is currently absent (undefined). Re-running it after a
// partial --confirm is safe and idempotent: already-migrated rows are
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

const packagesById = new Map((db.membershipPackages ?? []).map((p) => [p.id, p]));
const categoriesById = new Map((db.membershipCategories ?? []).map((c) => [c.id, c]));

function ownerGymForPackageId(productId) {
  if (!productId) return { scope: "unresolved" };
  const pkg = packagesById.get(productId);
  if (!pkg) return { scope: "unresolved" };
  if (pkg.deliveryChannel === "app_only") return { scope: "platform" };
  const category = categoriesById.get(pkg.categoryId);
  if (!category) return { scope: "unresolved" };
  return { scope: "gym", gymId: category.gymId ?? null };
}

const stats = { total: 0, alreadySet: 0, gym: 0, platform: 0, unresolved: 0 };

for (const sub of db.subscriptions ?? []) {
  stats.total++;
  if (sub.ownerGym !== undefined) {
    stats.alreadySet++;
    continue;
  }
  sub.ownerGym = ownerGymForPackageId(sub.packageId);
  stats[sub.ownerGym.scope === "gym" ? "gym" : sub.ownerGym.scope]++;
}

console.log(`\nSubscription ownerGym backfill — ${args.confirm ? "APPLYING" : "DRY RUN"}\n`);
console.log(`subscriptions: ${stats.total} total, ${stats.alreadySet} already set`);
console.log(`  newly resolved: gym=${stats.gym} platform=${stats.platform} unresolved=${stats.unresolved}`);

if (stats.unresolved > 0) {
  console.log(
    `\n${stats.unresolved} subscription(s) could not be resolved to a gym or platform scope and are marked`
  );
  console.log(`"unresolved". This is expected for a legacy/removed-product subscription, or one with no packageId.`);
  console.log(`Review "unresolved" rows manually before relying on gym-filtered subscription reporting.`);
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
