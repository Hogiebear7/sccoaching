// Permanently delete class types (ClassCategoryRecord) by slug, cascading
// through everything that references them — the staff UI's normal delete
// (/api/staff/categories/delete) refuses this outright while a class type is
// still in use (see countClassesByCategorySlug/countPackagesByEligibleClassType
// in lib/db.ts), which is correct for day-to-day staff use but blocks a full
// reset of seed/demo scheduling data. This script does the reassignment that
// guard is asking for, then deletes the class type:
//   1. delete bookings for any class in this category
//   2. delete waitlist entries for any class in this category
//   3. delete the classes themselves
//   4. remove the slug from every package's eligibleClassTypes
//      (NOTE: a package left with an empty eligibleClassTypes list is
//      interpreted by the app as "eligible for all class types" — not
//      "eligible for none". Check packages afterward if that's not intended.)
//   5. delete the class type record (its name is preserved in
//      deletedCategoryLabels, same as the normal delete path, so any
//      untouched historical reference still displays a name instead of a
//      raw slug)
//
//   npm run delete:class-types -- cardio general mother_and_baby strength
//   npm run delete:class-types -- cardio general mother_and_baby strength --confirm
//
// Safety:
//  - Dry run by default; nothing is written without --confirm.
//  - Backs up data/db.json to data/db.json.bak-<ts> before writing.
// Set GYM_DB_PATH to target a different db file (used by tests).

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));
const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const slugs = args.filter((a) => a !== "--confirm");

if (slugs.length === 0) {
  console.error("Usage: npm run delete:class-types -- <slug> [<slug> ...] [--confirm]");
  process.exit(1);
}

if (!existsSync(DB_PATH)) {
  console.error(`✗ Database not found at ${DB_PATH}.`);
  process.exit(1);
}

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));
const categories = db.classCategories ?? [];

const targets = categories.filter((c) => slugs.includes(c.slug));
const notFound = slugs.filter((s) => !categories.some((c) => c.slug === s));
const targetSlugs = new Set(targets.map((c) => c.slug));

const classes = (db.classes ?? []).filter((c) => targetSlugs.has(c.category));
const classIds = new Set(classes.map((c) => c.id));
const bookings = (db.bookings ?? []).filter((b) => classIds.has(b.classId));
const waitlist = (db.waitlistEntries ?? []).filter((w) => classIds.has(w.classId));
const affectedPackages = (db.membershipPackages ?? []).filter((p) =>
  (p.eligibleClassTypes ?? []).some((s) => targetSlugs.has(s))
);

console.log(`\nDelete class types — ${CONFIRM ? "APPLYING" : "DRY RUN"}\n`);
if (notFound.length > 0) console.log(`⚠ Not found (skipped): ${notFound.join(", ")}`);
console.log(`Class types to delete (${targets.length}):`);
targets.forEach((c) => console.log(`  ✗ ${c.name} (${c.slug})`));
console.log(`\nCascade:`);
console.log(`  classes           ${classes.length}`);
classes.forEach((c) => console.log(`    - ${c.title} · ${c.date} ${c.startTime}`));
console.log(`  bookings          ${bookings.length}`);
console.log(`  waitlist entries  ${waitlist.length}`);
console.log(`  packages touched  ${affectedPackages.length}`);
affectedPackages.forEach((p) =>
  console.log(`    - ${p.name}: [${p.eligibleClassTypes.join(", ")}] → [${p.eligibleClassTypes.filter((s) => !targetSlugs.has(s)).join(", ")}]`)
);

if (targets.length === 0) {
  console.log(`\nNothing to do.\n`);
  process.exit(0);
}

if (!CONFIRM) {
  console.log(`\nNothing written. Re-run with --confirm to apply.\n`);
  process.exit(0);
}

const backup = `${DB_PATH}.bak-${Date.now()}`;
copyFileSync(DB_PATH, backup);

db.bookings = (db.bookings ?? []).filter((b) => !classIds.has(b.classId));
db.waitlistEntries = (db.waitlistEntries ?? []).filter((w) => !classIds.has(w.classId));
db.classes = (db.classes ?? []).filter((c) => !targetSlugs.has(c.category));
db.membershipPackages = (db.membershipPackages ?? []).map((p) => ({
  ...p,
  eligibleClassTypes: (p.eligibleClassTypes ?? []).filter((s) => !targetSlugs.has(s)),
}));
db.deletedCategoryLabels = { ...db.deletedCategoryLabels };
for (const c of targets) db.deletedCategoryLabels[c.slug] = c.name;
db.classCategories = categories.filter((c) => !targetSlugs.has(c.slug));

writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");

console.log(`\n✓ Deleted ${targets.length} class type(s), ${classes.length} class(es), ${bookings.length} booking(s), ${waitlist.length} waitlist entr${waitlist.length === 1 ? "y" : "ies"}.`);
console.log(`  Backup written: ${backup}\n`);
