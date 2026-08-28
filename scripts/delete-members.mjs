// Permanently delete specific member accounts and everything they own —
// direct data-layer equivalent of lib/db.ts's deleteUserAndOwnedRecords(),
// used here because that function is normally reached through
// /api/staff/members/[userId]/delete, which deliberately refuses to hard
// delete an ACTIVE member (archive-first is the safety rail for real member
// data). This script is for clearing seed/test accounts during development,
// so it intentionally skips that precondition — never point it at real
// member data.
//
//   npm run delete:members -- alex@demo.local morgan@demo.local
//   npm run delete:members -- alex@demo.local morgan@demo.local --confirm
//
// Safety:
//  - Dry run by default; nothing is written without --confirm.
//  - Never removes a staff account (coach/admin/admin_manager/staff), even
//    if its email is passed by mistake.
//  - Backs up data/db.json to data/db.json.bak-<ts> before writing.
// Set GYM_DB_PATH to target a different db file (used by tests).

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));
const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const emails = args.filter((a) => a !== "--confirm").map((e) => e.toLowerCase());

if (emails.length === 0) {
  console.error("Usage: npm run delete:members -- <email> [<email> ...] [--confirm]");
  process.exit(1);
}

if (!existsSync(DB_PATH)) {
  console.error(`✗ Database not found at ${DB_PATH}.`);
  process.exit(1);
}

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));
const users = db.users ?? [];

const STAFF_ROLES = new Set(["coach", "admin", "admin_manager", "staff"]);

const targets = users.filter((u) => emails.includes(u.email.toLowerCase()));
const notFound = emails.filter((e) => !users.some((u) => u.email.toLowerCase() === e));
const refusedStaff = targets.filter((u) => STAFF_ROLES.has(u.role));
const doomed = targets.filter((u) => !STAFF_ROLES.has(u.role));
const doomedIds = new Set(doomed.map((u) => u.id));

// Mirrors MEMBER_OWNED_COLLECTIONS in lib/db.ts — keep in sync.
const BY_USER_ID = [
  "profiles", "resetTokens", "emailChangeRequests", "programmes", "trainingPrograms", "gymProfiles",
  "workoutSessions", "aiMessages", "bodyWeightLogs", "bodyFatLogs", "bookings", "noShows",
  "attendanceWatchlist", "subscriptions", "recoveryLogs", "waterLogs", "waitlistEntries",
  "cycleSettings", "cyclePrivacyPreferences", "pregnancyStatus", "pushSubscriptions", "expoPushTokens", "notifications",
  "purchases", "passLedger", "pendingCancellationCredits", "coachNotes", "weeklyTrainingSchedules",
  "nutritionTargets", "foodEntries", "foodIdentificationOverrides", "foodSubmissions",
  "recipes", "shoppingListItems",
];

const report = {};
for (const key of BY_USER_ID) {
  const arr = db[key] ?? [];
  report[key] = arr.filter((r) => doomedIds.has(r.userId)).length;
}
report.messages = (db.messages ?? []).filter((m) => doomedIds.has(m.memberId)).length;
// Custom foods use ownerUserId, not userId — see lib/db.ts's deleteUserAndOwnedRecords.
report.customFoods = (db.customFoods ?? []).filter((f) => doomedIds.has(f.ownerUserId)).length;

console.log(`\nDelete members — ${CONFIRM ? "APPLYING" : "DRY RUN"}\n`);
if (notFound.length > 0) console.log(`⚠ Not found (skipped): ${notFound.join(", ")}`);
if (refusedStaff.length > 0) console.log(`⚠ Refused (staff account, skipped): ${refusedStaff.map((u) => u.email).join(", ")}`);
console.log(`\nMembers to delete (${doomed.length}):`);
doomed.forEach((u) => console.log(`  ✗ ${u.fullName ?? u.email} <${u.email}>`));
console.log(`\nRecords to remove:`);
for (const [key, n] of Object.entries(report)) {
  if (n > 0) console.log(`  ${key.padEnd(24)} ${n}`);
}

if (doomed.length === 0) {
  console.log(`\nNothing to do.\n`);
  process.exit(0);
}

if (!CONFIRM) {
  console.log(`\nNothing written. Re-run with --confirm to apply.\n`);
  process.exit(0);
}

const backup = `${DB_PATH}.bak-${Date.now()}`;
copyFileSync(DB_PATH, backup);

db.users = users.filter((u) => !doomedIds.has(u.id));
for (const key of BY_USER_ID) {
  if (Array.isArray(db[key])) db[key] = db[key].filter((r) => !doomedIds.has(r.userId));
}
db.messages = (db.messages ?? []).filter((m) => !doomedIds.has(m.memberId));
if (Array.isArray(db.customFoods)) db.customFoods = db.customFoods.filter((f) => !doomedIds.has(f.ownerUserId));

writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");

console.log(`\n✓ Deleted ${doomed.length} account(s) and their owned records.`);
console.log(`  Backup written: ${backup}\n`);
