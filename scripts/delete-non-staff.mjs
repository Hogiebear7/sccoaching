// Delete every NON-staff account and all of that member's owned records,
// keeping the existing staff account(s) fully intact.
//
//   npm run delete:non-staff              → DRY RUN (prints what would happen)
//   npm run delete:non-staff -- --confirm → actually deletes (backs up first)
//
// Safety:
//  - Dry run by default; nothing is written without --confirm.
//  - Never removes staff users. Aborts if that would leave zero staff.
//  - Backs up data/db.json to data/db.json.bak-<ts> before writing.
//  - Only touches member-OWNED collections. Staff-owned/global data
//    (classes, exercises, catalog, categories, payment events) is untouched.
// Set GYM_DB_PATH to target a different db file (used by tests).

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));
const CONFIRM = process.argv.includes("--confirm");

if (!existsSync(DB_PATH)) {
  console.error(`✗ Database not found at ${DB_PATH}.`);
  process.exit(1);
}

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));
const users = db.users ?? [];

// Any elevated role is "staff": coach/admin/admin_manager, plus the legacy
// "staff" alias. Only plain members are deleted.
const STAFF_ROLES = new Set(["coach", "admin", "admin_manager", "staff"]);
const staff = users.filter((u) => STAFF_ROLES.has(u.role));
const doomed = users.filter((u) => !STAFF_ROLES.has(u.role));
const doomedIds = new Set(doomed.map((u) => u.id));

if (staff.length === 0) {
  console.error("✗ Refusing to run: there are no staff accounts, so this would delete ALL users.");
  process.exit(1);
}

// Collections keyed by a member's user id → drop rows owned by a doomed user.
const BY_USER_ID = [
  "profiles", "resetTokens", "programmes", "workoutSessions", "aiMessages",
  "bodyWeightLogs", "bookings", "subscriptions", "recoveryLogs", "waitlistEntries",
  "cycleSettings", "cyclePrivacyPreferences", "pushSubscriptions", "notifications",
  "purchases", "passLedger", "coachNotes",
];

// Compute deletion counts without mutating (for the dry-run report).
const report = {};
for (const key of BY_USER_ID) {
  const arr = db[key] ?? [];
  report[key] = arr.filter((r) => doomedIds.has(r.userId)).length;
}
// messages are keyed by memberId (the member the thread belongs to).
report.messages = (db.messages ?? []).filter((m) => doomedIds.has(m.memberId)).length;
report.users = doomed.length;

// Orphan check: a kept class coached by a doomed user would break. Shouldn't
// happen (coaches are staff) but surface it rather than silently proceed.
const orphanClasses = (db.classes ?? []).filter((c) => doomedIds.has(c.coachUserId));

console.log(`\nDelete non-staff accounts — ${CONFIRM ? "APPLYING" : "DRY RUN"}\n`);
console.log(`Staff kept (${staff.length}):`);
staff.forEach((u) => console.log(`  ✓ ${u.email}`));
console.log(`\nMembers to delete (${doomed.length}):`);
doomed.forEach((u) => console.log(`  ✗ ${u.email}`));
console.log(`\nRecords to remove:`);
for (const [key, n] of Object.entries(report)) {
  if (n > 0) console.log(`  ${key.padEnd(24)} ${n}`);
}
if (orphanClasses.length > 0) {
  console.log(`\n⚠ ${orphanClasses.length} class(es) are coached by a to-be-deleted user (coachUserId).`);
  console.log(`  These are LEFT IN PLACE (classes are not member-owned). Reassign their coach in staff tools.`);
}

if (!CONFIRM) {
  console.log(`\nNothing written. Re-run with --confirm to apply.\n`);
  process.exit(0);
}

// ── Apply ──
const backup = `${DB_PATH}.bak-${Date.now()}`;
copyFileSync(DB_PATH, backup);

db.users = users.filter((u) => !doomedIds.has(u.id));
for (const key of BY_USER_ID) {
  if (Array.isArray(db[key])) db[key] = db[key].filter((r) => !doomedIds.has(r.userId));
}
db.messages = (db.messages ?? []).filter((m) => !doomedIds.has(m.memberId));

writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");

console.log(`\n✓ Deleted ${doomed.length} account(s) and their owned records.`);
console.log(`  Staff remaining: ${db.users.length}`);
console.log(`  Backup written: ${backup}\n`);
