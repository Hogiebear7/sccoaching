// READ-ONLY list of every account in the original S&C gym (accounts with no gym id), with a guess at which ones look like test accounts, for cleaning up before launch.
// Reads the datastore once; writes NOTHING to it; takes no lock. Writes a spreadsheet-friendly CSV beside where you run it and prints a short table.
//
//   node scripts/members-list.mjs                       (uses GYM_DB_PATH, else data/db.json beside the app)
//   node scripts/members-list.mjs --out my-list.csv     (choose the CSV file name)
//
// "Looks like a test" is only a hint (a test-style email or name, an App Store review account, or an account that has never done anything). It never decides anything; you do.
import { existsSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const OUT = outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : `sc-members-${new Date().toISOString().slice(0, 10)}.csv`;
const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));
if (!existsSync(DB_PATH)) {
  console.error(`Database not found at ${DB_PATH}.`);
  process.exit(1);
}
const db = JSON.parse(readFileSync(DB_PATH, "utf8"));

const day = (v) => (typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : "");
const latest = (...vals) => vals.map(day).filter(Boolean).sort().at(-1) ?? "";
const byUser = (rows, pick) => {
  const m = new Map();
  for (const r of rows ?? []) {
    if (!r?.userId) continue;
    const d = day(pick(r));
    if (d && (!m.get(r.userId) || d > m.get(r.userId))) m.set(r.userId, d);
  }
  return m;
};

const profiles = new Map((db.profiles ?? []).map((p) => [p.userId, p]));
const packages = new Map((db.membershipPackages ?? []).map((p) => [p.id, p.name]));
const subs = new Map((db.subscriptions ?? []).map((s) => [s.userId, s]));
const lastClass = byUser((db.bookings ?? []).filter((b) => b.attendedAt), (b) => b.attendedAt);
const lastBooked = byUser(db.bookings, (b) => b.createdAt);
const lastSession = byUser(db.workoutSessions, (s) => s.date ?? s.createdAt);
const lastFood = byUser(db.foodEntries, (f) => f.date ?? f.createdAt);
const lastRecovery = byUser(db.recoveryLogs, (r) => r.date ?? r.createdAt);

const TEST_EMAIL = /(@example\.|@test\.|@demo\.|@mailinator|@yopmail|\+test|\btest\b|\bdemo\b|applereview|review\d*@|tester|dummy|fake)/i;
const TEST_NAME = /\b(test|demo|apple|review|tester|dummy|fake|sample)\b/i;

const rows = (db.users ?? [])
  .filter((u) => !u.gymId)
  .map((u) => {
    const p = profiles.get(u.id);
    const s = subs.get(u.id);
    const lastSeen = latest(lastClass.get(u.id), lastSession.get(u.id), lastFood.get(u.id), lastRecovery.get(u.id), lastBooked.get(u.id));
    const name = (p?.fullName ?? "").replace(/\s+/g, " ").trim();
    const reasons = [];
    if (TEST_EMAIL.test(u.email ?? "")) reasons.push("test-style email");
    if (name && TEST_NAME.test(name)) reasons.push("test-style name");
    if (!lastSeen && u.role === "member") reasons.push("never used the app");
    return {
      name,
      email: u.email ?? "",
      role: u.role ?? "",
      joined: day(u.createdAt),
      archived: u.archivedAt ? "archived" : "",
      plan: s?.packageId ? packages.get(s.packageId) ?? "(unknown plan)" : "",
      planStatus: s?.status ?? "",
      lastClass: lastClass.get(u.id) ?? "",
      lastSeen,
      looksLikeTest: reasons.length ? reasons.join("; ") : "",
    };
  })
  .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role.localeCompare(b.role)));

const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
const header = ["Name", "Email", "Role", "Joined", "Archived", "Plan", "Plan status", "Last class attended", "Last activity", "Looks like a test?"];
const csv = [header, ...rows.map((r) => [r.name, r.email, r.role, r.joined, r.archived, r.plan, r.planStatus, r.lastClass, r.lastSeen, r.looksLikeTest])].map((r) => r.map(cell).join(",")).join("\n");
writeFileSync(OUT, `﻿${csv}\n`, "utf8");

const count = (f) => rows.filter(f).length;
console.log(`S&C accounts (${DB_PATH})`);
console.log(`Total ${rows.length}: members ${count((r) => r.role === "member")}, staff ${count((r) => r.role !== "member")}, archived ${count((r) => r.archived)}.`);
console.log(`Possible test accounts: ${count((r) => r.looksLikeTest)}.\n`);
for (const r of rows) console.log(`${(r.role === "member" ? "member" : r.role).padEnd(14)} ${(r.name || "(no name)").slice(0, 26).padEnd(27)} ${r.email.slice(0, 34).padEnd(35)} joined ${r.joined || "?".padEnd(10)} seen ${r.lastSeen || "never".padEnd(10)} ${r.plan ? `[${r.plan}]` : ""} ${r.looksLikeTest ? `<-- ${r.looksLikeTest}` : ""}`);
console.log(`\nSpreadsheet written to ${OUT}`);
