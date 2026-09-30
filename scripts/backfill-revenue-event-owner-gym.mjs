// Backfills RevenueEventRecord.ownerGym onto revenue-event rows written
// before that field existed. Same conventions as
// scripts/backfill-subscription-owner-gym.mjs (PR #51) — see that script's
// own header for the shared design rationale.
//
//   node scripts/backfill-revenue-event-owner-gym.mjs --report
//   node scripts/backfill-revenue-event-owner-gym.mjs --confirm
//
// Ownership is derived ONLY from authoritative existing relationships —
// never guessed, never defaulted to the primary gym just because there is
// currently one gym:
//  - RevenueSource is solely "membership_renewal" (see RevenueEventRecord's
//    own comment in lib/db.ts) — a revenue event is NEVER linked to a
//    PurchaseRecord, only to the paying member's SubscriptionRecord (there
//    is at most one per user, upserted by userId — see lib/db.ts's
//    saveSubscription). This mirrors exactly what every write site
//    (app/api/stripe/webhook, app/api/billing/webhook, both Google Play
//    routes) already does at creation time.
//  - provider === "google_play" -> always {scope:"platform"}. Google Play
//    sells only the one platform-wide App Subscription product
//    (deliveryChannel: "app_only") — there is no gym-owned Google Play
//    revenue, by construction, so this needs no lookup at all.
//  - provider === "stripe" | "revolut" -> the linked SubscriptionRecord's
//    own ownerGym (found by the event's userId), which is itself immutable
//    historical provenance (PR #51) — NEVER recomputed from the
//    subscription's CURRENT package, exactly like every write site already
//    does. A user with no subscription row at all, or whose subscription
//    row predates the ownerGym field, is left "unresolved" rather than
//    guessed.
//
// Every record keeps whatever it already had — this migration only fills in
// rows where ownerGym is currently absent (undefined). Re-running it after a
// partial --confirm is safe and idempotent.
//
// Safety: --report is read-only and prints counts only (no event id,
// payment id, user id, or record contents). Dry run by default; nothing is
// written without --confirm. The db file is backed up to <db>.bak-<ts>
// first. Set GYM_DB_PATH to target a different db file (used by tests).

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

const subscriptionsByUserId = new Map((db.subscriptions ?? []).map((s) => [s.userId, s]));

function ownerGymForRevenueEvent(event) {
  if (event.provider === "google_play") return { scope: "platform" };
  const subscription = subscriptionsByUserId.get(event.userId);
  if (!subscription) return { scope: "unresolved" };
  return subscription.ownerGym ?? { scope: "unresolved" };
}

const stats = { total: 0, alreadySet: 0, gym: 0, platform: 0, unresolved: 0 };

for (const event of db.revenueEvents ?? []) {
  stats.total++;
  if (event.ownerGym !== undefined) {
    stats.alreadySet++;
    continue;
  }
  event.ownerGym = ownerGymForRevenueEvent(event);
  stats[event.ownerGym.scope === "gym" ? "gym" : event.ownerGym.scope]++;
}

console.log(`\nRevenue-event ownerGym backfill — ${args.confirm ? "APPLYING" : "DRY RUN"}\n`);
console.log(`revenue events: ${stats.total} total, ${stats.alreadySet} already set`);
console.log(`  newly resolved: gym=${stats.gym} platform=${stats.platform} unresolved=${stats.unresolved}`);

if (stats.unresolved > 0) {
  console.log(
    `\n${stats.unresolved} revenue event(s) could not be resolved to a gym or platform scope and are marked`
  );
  console.log(`"unresolved". This is expected for a Stripe/Revolut renewal whose paying member no longer has a`);
  console.log(`subscription row, or whose subscription row predates ownerGym. Review these manually before`);
  console.log(`relying on gym-filtered revenue reporting.`);
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
