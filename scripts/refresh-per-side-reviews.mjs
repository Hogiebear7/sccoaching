// Clears the saved AI session-review paragraph on workouts whose volume the server used to count wrongly, so the review is written again, with the right
// volume, the next time the member opens it.
//
//   node scripts/refresh-per-side-reviews.mjs --names "Full Name,Full Name"            (report only, writes nothing)
//   node scripts/refresh-per-side-reviews.mjs --names "Full Name,Full Name" --confirm  (applies)
//
// WHY. A workout with per-side sets (a single-arm press, a lunge: right and left reps are stored and `reps` is empty) was counted by the server as 0 reps for
// those sets, so leaderboards, challenges, profile stats and the session review all showed less volume than the app. Fixed in the code (setRepsDone in
// lib/member-stats.ts). Every total is worked out when it is read, so all of those are already right for every past workout and nothing is stored to correct.
// The one thing that IS stored is the AI review paragraph (reviewText), written once with the old, lower volume in its text. This clears just that paragraph for
// the affected workouts (and its timestamp). It is written again on the next view; each one is a small AI call and counts against the member's allowance.
//
// What it touches: only workouts of the named members that (1) have at least one per-side set, (2) have a saved review, and (3) have a volume that changes with the
// fix. Nothing else is read for change or written. Dry run by default; the db file is copied to <db>.bak-<timestamp> before writing. Prints only dates, titles and
// volumes, never emails. Set GYM_DB_PATH to point at the datastore file (the default is data/db.json beside the app).
import { copyFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "node:module";
const { readForScript, writeForScript } = createRequire(import.meta.url)("../lib/datastore/core.js");

const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));

function fail(msg) {
  console.error(`x ${msg}`);
  process.exit(1);
}

const args = { names: [], confirm: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--confirm") args.confirm = true;
  else if (argv[i] === "--names") args.names = String(argv[++i] ?? "").split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
  else fail(`Unknown argument "${argv[i]}".`);
}
if (args.names.length === 0) fail('Give the members with --names "First Last,First Last".');
if (!existsSync(DB_PATH)) fail(`Database not found at ${DB_PATH}.`);

const { db, token } = readForScript(DB_PATH);

const num = (w) => {
  const n = w ? parseFloat(w) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const isPerSide = (s) => s.reps == null && s.repsRight != null && s.repsLeft != null;

/** The volume the server used to report (a per-side set counted as 0 reps) and the one it reports now (right + left). */
function volumes(session) {
  let before = 0;
  let after = 0;
  let perSideSets = 0;
  for (const ex of session.exercises ?? []) {
    if (ex.setDetails && ex.setDetails.length > 0) {
      for (const s of ex.setDetails) {
        before += num(s.weight) * (s.reps ?? 0);
        after += num(s.weight) * (s.reps != null ? s.reps : isPerSide(s) ? s.repsRight + s.repsLeft : 0);
        if (isPerSide(s)) perSideSets++;
      }
    } else {
      const v = num(ex.weight) * (ex.reps ?? 0) * (ex.sets ?? 0);
      before += v;
      after += v;
    }
  }
  return { before: Math.round(before), after: Math.round(after), perSideSets };
}

const profiles = (db.profiles ?? []).filter((p) => args.names.includes(String(p.fullName ?? "").trim().toLowerCase()));
const found = new Set(profiles.map((p) => String(p.fullName).trim().toLowerCase()));
for (const n of args.names) if (!found.has(n)) console.log(`(no member found called "${n}")`);
const ambiguous = args.names.filter((n) => profiles.filter((p) => String(p.fullName).trim().toLowerCase() === n).length > 1);
if (ambiguous.length) fail(`More than one account has the name: ${ambiguous.join(", ")}. Nothing done; tell Claude.`);

let sessionsSeen = 0;
let withPerSide = 0;
let toRefresh = 0;
console.log(`\nPer-side volume review refresh: ${args.confirm ? "APPLYING" : "DRY RUN"}\n`);
for (const p of profiles) {
  const mine = (db.workoutSessions ?? []).filter((s) => s.userId === p.userId);
  console.log(`${p.fullName}: ${mine.length} workouts`);
  for (const s of mine.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    sessionsSeen++;
    const v = volumes(s);
    if (v.perSideSets === 0) continue;
    withPerSide++;
    const hasReview = Boolean(s.reviewText);
    const changes = v.before !== v.after;
    console.log(`  ${s.date}  ${String(s.title ?? "").slice(0, 40).padEnd(40)} was ${v.before} kg, now ${v.after} kg${hasReview ? "  [saved review]" : ""}${changes ? "" : "  (unchanged)"}`);
    if (hasReview && changes) {
      toRefresh++;
      if (args.confirm) {
        s.reviewText = null;
        s.reviewGeneratedAt = null;
      }
    }
  }
}

console.log(`\nWorkouts looked at: ${sessionsSeen}. With per-side sets: ${withPerSide}. Saved reviews to refresh: ${toRefresh}.`);
console.log("Volumes on leaderboards, challenges and profiles need no change: they are worked out when read.");

if (!args.confirm) {
  console.log("\nNothing written. Re-run with --confirm to clear those saved reviews.\n");
  process.exit(0);
}
if (toRefresh === 0) {
  console.log("\nNothing to change.\n");
  process.exit(0);
}
const backup = `${DB_PATH}.bak-${Date.now()}`;
copyFileSync(DB_PATH, backup);
writeForScript(DB_PATH, db, token);
console.log(`\nDone. ${toRefresh} saved review(s) cleared; they are written again on next view.\n  Backup written: ${backup}\n`);
