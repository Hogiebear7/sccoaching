// Creates the one GymRecord for S&C Performance Coaching itself — "gym #1"
// in the new multi-tenant gyms table (see lib/gyms-schema.ts). Every other
// gym gets a row here via the eventual self-serve signup flow; this script
// exists only because S&C predates that table and needs a one-time,
// hand-entered row instead.
//
// Values below mirror lib/content.ts's BRAND_NAME/BRAND_TAGLINE/CONTACT_INFO
// — duplicated rather than imported, matching every other script in this
// directory (plain .mjs run directly via node, not through the Next.js/TS
// build, so importing a .ts file isn't available here). Keep in sync with
// lib/content.ts if that copy ever changes; lib/content.ts itself is left
// untouched by this script and stays the source of truth for the public
// site and the (auth) pages, several of which are client components that
// can't read the database directly. The slug below is duplicated again in
// lib/primary-gym.ts's PRIMARY_GYM_SLUG for app code (e.g. the nearby-search
// route's "recommended" pin) — same reasoning, keep both in sync.
//
// latitude/longitude are hand-entered (central Navan, Co. Meath) since
// there's no real address on file to geocode automatically — update these
// directly in the database (or via a future admin screen) if a precise
// location is ever added.
//
//   npm run seed:primary-gym
//   npm run seed:primary-gym -- --confirm
//
// Safety:
//  - Dry run by default; nothing is written without --confirm.
//  - Backs up data/db.json to data/db.json.bak-<ts> before writing.
//  - Idempotent — does nothing if a gym with this slug already exists.
// Set GYM_DB_PATH to target a different db file (used by tests).

import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));
const CONFIRM = process.argv.slice(2).includes("--confirm");

export const PRIMARY_GYM_SLUG = "sc-performance-coaching";

const GYM = {
  slug: PRIMARY_GYM_SLUG,
  name: "S&C Performance Coaching",
  tagline: "Science-backed training, nutrition and recovery — all in one place.",
  description: null,
  contactEmail: "info@sandccoaching.com",
  contactPhone: "+353830079025",
  addressLine: "Navan, Co. Meath",
  latitude: 53.6528,
  longitude: -6.6819,
};

if (!existsSync(DB_PATH)) {
  console.error(`✗ Database not found at ${DB_PATH}.`);
  process.exit(1);
}

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));

const existing = (db.gyms ?? []).find((g) => g.slug === PRIMARY_GYM_SLUG);

console.log(`\nSeed primary gym (S&C Performance Coaching) — ${CONFIRM ? "APPLYING" : "DRY RUN"}\n`);

if (existing) {
  console.log(`Already present (id: ${existing.id}). Nothing to do.\n`);
  process.exit(0);
}

// Owner must be a real staff account — prefers the most senior role present,
// since that's most likely to be the actual business owner rather than a
// coach hired later. Every real deployment of this app has at least one
// admin_manager by the time this script would ever run (created via
// scripts/create-staff.mjs), so this is a hard requirement, not a soft one.
const ROLE_RANK = { admin_manager: 3, admin: 2, coach: 1 };
const owner = (db.users ?? [])
  .filter((u) => ROLE_RANK[u.role] !== undefined)
  .sort((a, b) => (ROLE_RANK[b.role] ?? 0) - (ROLE_RANK[a.role] ?? 0))[0];

if (!owner) {
  console.error("✗ No staff account exists to own this gym. Create one first (npm run create:staff).");
  process.exit(1);
}

console.log(`Will create gym "${GYM.name}" (slug "${GYM.slug}"), owned by ${owner.email}.`);

if (!CONFIRM) {
  console.log(`\nNothing written. Re-run with --confirm to apply.\n`);
  process.exit(0);
}

const backup = `${DB_PATH}.bak-${Date.now()}`;
copyFileSync(DB_PATH, backup);

const now = new Date().toISOString();
const gym = {
  id: randomUUID(),
  ...GYM,
  ownerUserId: owner.id,
  status: "active",
  createdAt: now,
  updatedAt: now,
};

db.gyms = [...(db.gyms ?? []), gym];
writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

console.log(`✓ Created gym (id: ${gym.id}).`);
console.log(`  Backup written: ${backup}\n`);
