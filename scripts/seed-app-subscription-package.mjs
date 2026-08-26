// Creates the one catalog package Tier 2 ("App Subscription") is granted
// against, for admin manual-grant and invite-link flows (see
// lib/member-access.ts / lib/membership-entitlement.ts). Mirrors
// scripts/seed-common-foods.mjs's dry-run/--confirm/backup safety pattern.
//
// Self-serve purchase of Tier 2 is explicitly out of scope for this pass —
// this package is billingChannel "manual" and visible: false so it never
// appears in the public checkout/membership pages; it only exists so staff
// can assign it via the tier-change route.
//
//   npm run seed:app-subscription-package
//   npm run seed:app-subscription-package -- --confirm
//
// Safety:
//  - Dry run by default; nothing is written without --confirm.
//  - Backs up data/db.json to data/db.json.bak-<ts> before writing.
//  - Idempotent — does nothing if a package with this slug already exists.
// Set GYM_DB_PATH to target a different db file (used by tests).

import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));
const CONFIRM = process.argv.slice(2).includes("--confirm");

export const APP_SUBSCRIPTION_PACKAGE_SLUG = "app-subscription-tier-2";

if (!existsSync(DB_PATH)) {
  console.error(`✗ Database not found at ${DB_PATH}.`);
  process.exit(1);
}

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));

const existingPackage = (db.membershipPackages ?? []).find((p) => p.slug === APP_SUBSCRIPTION_PACKAGE_SLUG);

console.log(`\nSeed App Subscription (Tier 2) package — ${CONFIRM ? "APPLYING" : "DRY RUN"}\n`);

if (existingPackage) {
  console.log(`Already present (id: ${existingPackage.id}). Nothing to do.\n`);
  process.exit(0);
}

const category = (db.membershipCategories ?? [])[0];
if (!category) {
  console.error("✗ No membership category exists to attach this package to. Create one first.");
  process.exit(1);
}

console.log(`Will create package "App Subscription" under category "${category.name}".`);

if (!CONFIRM) {
  console.log(`\nNothing written. Re-run with --confirm to apply.\n`);
  process.exit(0);
}

const backup = `${DB_PATH}.bak-${Date.now()}`;
copyFileSync(DB_PATH, backup);

const now = new Date().toISOString();
const pkg = {
  id: randomUUID(),
  categoryId: category.id,
  name: "App Subscription",
  slug: APP_SUBSCRIPTION_PACKAGE_SLUG,
  shortDescription: "App-only access, granted by staff or invite — not sold through checkout.",
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
  billingChannel: "manual",
  accessType: "subscription",
  createdAt: now,
  updatedAt: now,
};

db.membershipPackages = [...(db.membershipPackages ?? []), pkg];
writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

console.log(`\n✓ Backed up db to ${backup}`);
console.log(`✓ Created package "${pkg.name}" (id: ${pkg.id})\n`);
