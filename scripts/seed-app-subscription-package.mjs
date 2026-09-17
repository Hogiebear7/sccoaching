// Creates the one catalog package Tier 2 ("App Subscription") is granted
// against, plus its three Google Play billing options (monthly / every 6
// months / yearly) — the primary purchase path is the native Play Billing
// flow (see lib/providers/google-play.ts,
// app/api/mobile/billing/google-play/verify/route.ts); staff manual-grant
// and invite-link flows (lib/member-access.ts / lib/membership-entitlement.ts)
// remain supported as a fallback. Mirrors scripts/seed-common-foods.mjs's
// dry-run/--confirm/backup safety pattern.
//
// This package stays visible: false so it never appears in the public
// checkout/membership pages — Tier 2 is only ever purchased from inside the
// mobile app's own paywall screen, never the web checkout.
//
// All three plans are base plans on the SAME Play Console subscription
// product (Monetize > Subscriptions > app_subscription_tier2 > Base plans) —
// Play lets one product carry several base plans at different cadences and
// prices. The base plan ids below (PLANS[].basePlanId) must be created in
// Play Console with these EXACT ids, or updated here to match whatever you
// actually create.
//
// The seeded prices mirror the real member-facing prices (confirmed with
// the client 2026-08-29: €12.99/mo, €53.99 every 6 months [~€9/mo], €84/yr
// [€7/mo]) so staff-side displays/reporting read correctly even before Play
// Console is fully wired up — but Play Console's own base-plan price is
// still what members actually get charged; keep these in sync if the real
// price ever changes.
//
//   npm run seed:app-subscription-package
//   npm run seed:app-subscription-package -- --confirm
//
// Safety:
//  - Dry run by default; nothing is written without --confirm.
//  - Backs up data/db.json to data/db.json.bak-<ts> before writing.
//  - Idempotent — only creates whatever plans/state are actually missing.
// Set GYM_DB_PATH to target a different db file (used by tests).
//
// Env (optional):
//   GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID   e.g. "app_subscription_tier2"

import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));
const CONFIRM = process.argv.slice(2).includes("--confirm");

export const APP_SUBSCRIPTION_PACKAGE_SLUG = "app-subscription-tier-2";

const GOOGLE_PLAY_PRODUCT_ID = process.env.GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID ?? "app_subscription_tier2";

const PLANS = [
  { basePlanId: "monthly", name: "App Subscription — Monthly", intervalUnit: "month", intervalCount: 1, amountCents: 1299, sortOrder: 0 },
  { basePlanId: "semiannual", name: "App Subscription — 6 Months", intervalUnit: "month", intervalCount: 6, amountCents: 5399, sortOrder: 1 },
  { basePlanId: "annual", name: "App Subscription — Yearly", intervalUnit: "year", intervalCount: 1, amountCents: 8400, sortOrder: 2 },
];

if (!existsSync(DB_PATH)) {
  console.error(`✗ Database not found at ${DB_PATH}.`);
  process.exit(1);
}

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));

let pkg = (db.membershipPackages ?? []).find((p) => p.slug === APP_SUBSCRIPTION_PACKAGE_SLUG);

console.log(`\nSeed App Subscription (Tier 2) package — ${CONFIRM ? "APPLYING" : "DRY RUN"}\n`);

const needsPackage = !pkg;
const needsChannelFlip = pkg && pkg.billingChannel !== "google_play";
const existingOptionsByBasePlan = new Map(
  pkg
    ? (db.membershipBillingOptions ?? [])
        .filter((o) => o.packageId === pkg.id && o.googlePlaySubscriptionId === GOOGLE_PLAY_PRODUCT_ID)
        .map((o) => [o.googlePlayBasePlanId, o])
    : []
);
const missingPlans = PLANS.filter((p) => !existingOptionsByBasePlan.has(p.basePlanId));
// Reconcile drift on plans that already exist — e.g. the real price changed,
// or (as happened once) a placeholder price was seeded before the real
// prices were known. Re-running this script is the way to fix that, so it
// has to actually update the record, not just no-op because *a* record
// exists.
const driftedPlans = PLANS.filter((p) => {
  const existing = existingOptionsByBasePlan.get(p.basePlanId);
  if (!existing) return false;
  return (
    existing.amountCents !== p.amountCents ||
    existing.intervalUnit !== p.intervalUnit ||
    existing.intervalCount !== p.intervalCount ||
    existing.name !== p.name
  );
});

if (!needsPackage && !needsChannelFlip && missingPlans.length === 0 && driftedPlans.length === 0) {
  console.log(`Already fully set up (package id: ${pkg.id}). Nothing to do.\n`);
  process.exit(0);
}

const category = pkg ? undefined : (db.membershipCategories ?? [])[0];
if (needsPackage && !category) {
  console.error("✗ No membership category exists to attach this package to. Create one first.");
  process.exit(1);
}

if (needsPackage) console.log(`Will create package "App Subscription" under category "${category.name}".`);
if (needsChannelFlip) console.log(`Will switch billingChannel "${pkg.billingChannel}" → "google_play".`);
for (const plan of missingPlans) {
  console.log(`Will create billing option "${plan.name}" (base plan "${plan.basePlanId}", ${(plan.amountCents / 100).toFixed(2)} EUR).`);
}
for (const plan of driftedPlans) {
  const existing = existingOptionsByBasePlan.get(plan.basePlanId);
  console.log(
    `Will update "${plan.basePlanId}": ${(existing.amountCents / 100).toFixed(2)} EUR → ${(plan.amountCents / 100).toFixed(2)} EUR.`
  );
}

if (!CONFIRM) {
  console.log(`\nNothing written. Re-run with --confirm to apply.\n`);
  process.exit(0);
}

const backup = `${DB_PATH}.bak-${Date.now()}`;
copyFileSync(DB_PATH, backup);

const now = new Date().toISOString();

if (needsPackage) {
  pkg = {
    id: randomUUID(),
    categoryId: category.id,
    name: "App Subscription",
    slug: APP_SUBSCRIPTION_PACKAGE_SLUG,
    shortDescription: "App-only access, purchased in-app via Google Play, or granted by staff/invite.",
    fullDescription: null,
    packageType: "membership",
    sessionAllowanceType: "unlimited",
    sessionAllowanceCount: null,
    eligibleClassTypes: [],
    visible: false,
    sortOrder: 999,
    stripeProductId: null,
    imageUrl: null,
    imageAlt: null,
    deliveryChannel: "app_only",
    billingChannel: "google_play",
    accessType: "subscription",
    createdAt: now,
    updatedAt: now,
  };
  db.membershipPackages = [...(db.membershipPackages ?? []), pkg];
} else if (needsChannelFlip) {
  pkg.billingChannel = "google_play";
  pkg.updatedAt = now;
}

if (missingPlans.length > 0) {
  const newOptions = missingPlans.map((plan) => ({
    id: randomUUID(),
    packageId: pkg.id,
    name: plan.name,
    billingType: "recurring",
    intervalUnit: plan.intervalUnit,
    intervalCount: plan.intervalCount,
    amountCents: plan.amountCents,
    currency: "eur",
    visible: false,
    sortOrder: plan.sortOrder,
    stripePriceId: null,
    googlePlaySubscriptionId: GOOGLE_PLAY_PRODUCT_ID,
    googlePlayBasePlanId: plan.basePlanId,
    createdAt: now,
    updatedAt: now,
  }));
  db.membershipBillingOptions = [...(db.membershipBillingOptions ?? []), ...newOptions];
}

for (const plan of driftedPlans) {
  const existing = existingOptionsByBasePlan.get(plan.basePlanId);
  const option = db.membershipBillingOptions.find((o) => o.id === existing.id);
  option.name = plan.name;
  option.intervalUnit = plan.intervalUnit;
  option.intervalCount = plan.intervalCount;
  option.amountCents = plan.amountCents;
  option.updatedAt = now;
}

writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

console.log(`\n✓ Backed up db to ${backup}`);
if (needsPackage) console.log(`✓ Created package "${pkg.name}" (id: ${pkg.id})`);
if (needsChannelFlip) console.log(`✓ Switched billingChannel to "google_play"`);
for (const plan of missingPlans) console.log(`✓ Created "${plan.name}"`);
for (const plan of driftedPlans) console.log(`✓ Updated "${plan.name}" to ${(plan.amountCents / 100).toFixed(2)} EUR`);
console.log("");
