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

import { createHash } from "crypto";
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
const candidates = users.filter((u) => !STAFF_ROLES.has(u.role));

// ── Google Play protection (mirrors lib/db.ts findProtectedPlayEntitlementInDb and lib/member-deletion-guard.ts) ──────────
// A member with a paid Google Play entitlement that is still running (active, past_due, paused, or cancelled but inside the
// paid period) is REFUSED, never deleted: Google would keep billing with nothing tracking it. Ended entitlements proceed, and
// their purchase records are ANONYMISED, not deleted. Keep in sync with those two files.
const NOW_MS = Date.now();
function protectedPlayState(userId) {
  for (const p of db.googlePlayPurchases ?? []) {
    if (p.userId !== userId || p.revokedAt) continue;
    if (p.status === "active" || p.status === "in_grace_period" || p.status === "paused") return p.status;
    if (p.status === "canceled" && typeof p.expiryTimeMillis === "number" && p.expiryTimeMillis > NOW_MS) return "canceled_until_expiry";
  }
  const sub = (db.subscriptions ?? []).find((s) => s.userId === userId);
  if (sub?.provider === "google_play" && ["active", "past_due", "paused"].includes(sub.status)) {
    const lapsed = sub.status === "active" && sub.currentPeriodEnd && new Date(sub.currentPeriodEnd).getTime() < NOW_MS;
    if (!lapsed) return sub.status;
  }
  return null;
}
const deletedOwnerId = (userId) => "deleted:" + createHash("sha256").update("member-deletion:" + userId).digest("hex").slice(0, 16);
const refusedPlay = candidates.filter((u) => protectedPlayState(u.id));
const doomed = candidates.filter((u) => !protectedPlayState(u.id));
const doomedIds = new Set(doomed.map((u) => u.id));

if (staff.length === 0) {
  console.error("✗ Refusing to run: there are no staff accounts, so this would delete ALL users.");
  process.exit(1);
}

// Collections keyed by a member's user id → drop rows owned by a doomed user.
// Mirrors MEMBER_OWNED_COLLECTIONS in lib/db.ts — keep in sync.
const BY_USER_ID = [
  "profiles", "resetTokens", "mobileHandoffTokens", "communityPrivacy", "workoutComments", "workoutLikes",
  "emailChangeRequests", "programmes", "trainingPrograms", "gymProfiles",
  "workoutSessions", "aiMessages", "bodyWeightLogs", "bodyFatLogs", "bookings", "noShows",
  "attendanceWatchlist", "subscriptions", "recoveryLogs", "waterLogs", "waitlistEntries",
  "cycleSettings", "cyclePrivacyPreferences", "pregnancyStatus", "pushSubscriptions", "expoPushTokens", "notifications",
  "purchases", "passLedger", "pendingCancellationCredits", "coachNotes", "weeklyTrainingSchedules",
  "nutritionTargets", "foodEntries", "foodIdentificationOverrides", "foodSubmissions",
  "recipes", "shoppingListItems",
];

// Compute deletion counts without mutating (for the dry-run report).
const report = {};
for (const key of BY_USER_ID) {
  const arr = db[key] ?? [];
  report[key] = arr.filter((r) => doomedIds.has(r.userId)).length;
}
// messages are keyed by memberId (the member the thread belongs to).
report.googlePlayPurchasesAnonymised = (db.googlePlayPurchases ?? []).filter((p) => doomedIds.has(p.userId)).length;
report.messages = (db.messages ?? []).filter((m) => doomedIds.has(m.memberId)).length;
// Custom foods use ownerUserId, not userId — see lib/db.ts's deleteUserAndOwnedRecords.
report.customFoods = (db.customFoods ?? []).filter((f) => doomedIds.has(f.ownerUserId)).length;
// Follows use followerId/followingId; comment reports use reporterId — neither has userId.
report.follows = (db.follows ?? []).filter((f) => doomedIds.has(f.followerId) || doomedIds.has(f.followingId)).length;
report.commentReports = (db.commentReports ?? []).filter((r) => doomedIds.has(r.reporterId)).length;
report.users = doomed.length;

// Orphan check: a kept class coached by a doomed user would break. Shouldn't
// happen (coaches are staff) but surface it rather than silently proceed.
const orphanClasses = (db.classes ?? []).filter((c) => doomedIds.has(c.coachUserId));

console.log(`\nDelete non-staff accounts — ${CONFIRM ? "APPLYING" : "DRY RUN"}\n`);
console.log(`Staff kept (${staff.length}):`);
staff.forEach((u) => console.log(`  ✓ ${u.email}`));
if (refusedPlay.length > 0) console.log(`\n⚠ Refused (active Google Play subscription, nothing deleted): ${refusedPlay.map((u) => u.email).join(", ")}`);
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
// Purchase records are anonymised, never deleted (see the Google Play protection block above).
if (Array.isArray(db.googlePlayPurchases)) {
  const at = new Date().toISOString();
  db.googlePlayPurchases = db.googlePlayPurchases.map((p) => (doomedIds.has(p.userId) ? { ...p, userId: deletedOwnerId(p.userId), anonymizedAt: at, updatedAt: at } : p));
}
db.messages = (db.messages ?? []).filter((m) => !doomedIds.has(m.memberId));
if (Array.isArray(db.customFoods)) db.customFoods = db.customFoods.filter((f) => !doomedIds.has(f.ownerUserId));
if (Array.isArray(db.follows)) db.follows = db.follows.filter((f) => !doomedIds.has(f.followerId) && !doomedIds.has(f.followingId));
if (Array.isArray(db.commentReports)) db.commentReports = db.commentReports.filter((r) => !doomedIds.has(r.reporterId));

writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");

console.log(`\n✓ Deleted ${doomed.length} account(s) and their owned records.`);
console.log(`  Staff remaining: ${db.users.length}`);
console.log(`  Backup written: ${backup}\n`);
