/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS audit script run directly with node */
// Static, heuristic audit: which functions read the datastore, then `await` something, then write the datastore. Those are check-then-act sequences that a
// file lock cannot make atomic (the lock is held for one synchronous turn). They are not new: they already race between two requests in ONE process.
// Run from the repository root:  node scripts/audit-await-gaps.cjs            (list)
//                                 node scripts/audit-await-gaps.cjs --check    (exit 1 if a function is not in REVIEWED below; used by the test suite)
//
// Every flagged function has a written disposition. A NEW flagged function fails --check until someone reads it and adds a line here, so the gap list cannot grow
// silently. Dispositions: FIXED = the write now applies to the row as it is after the last await (updateSubscription / updateTrainingProgram / updateWorkoutSession /
// saveTrainingProgramIfUnchanged / a re-read); APPEND-ONLY = the writes only add new records, which a stale read cannot overwrite; PARSE-ONLY = the only awaits are
// request parsing, the writes are new records or targeted changes; NOISE = the heuristic counted a word in a comment.
const fs = require("fs");
const path = require("path");

const dbSrc = fs.readFileSync("lib/db.ts", "utf8");
const exported = [...dbSrc.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
const WRITE = /^(save|create|update|delete|append|set|record|claim|complete|mark|add|remove|follow|unfollow|archive|restore|purge|reset|toggle|insert|upsert|expire|cancel|apply|grant|bulk|clear|rename|resolve|finish|use|credit|debit|log|reject|accept|redeem|revoke|merge|move|replace|put)/i;
const writes = new Set(exported.filter((n) => WRITE.test(n)));
const reads = new Set(exported.filter((n) => !WRITE.test(n)));

const REVIEWED = {
  "app/api/ai/chat/route.ts::POST": "APPEND-ONLY: stores the member's message and the reply as new records after the stream",
  "app/api/ai/nutrition-coach/route.ts::POST": "APPEND-ONLY: same as the AI coach chat",
  "app/api/billing/webhook/route.ts::POST": "PARSE-ONLY: the only await is the raw request body, read before any datastore read",
  "app/api/stripe/webhook/route.ts::POST": "PARSE-ONLY: the only await is the raw request body, read before any datastore read",
  "app/api/membership/checkout/route.ts::POST": "FIXED: after each Stripe call the subscription is changed through updateSubscription (only our pending fields, only if our staged switch is still the current one)",
  "app/api/staff/members/[userId]/pause/route.ts::POST": "FIXED: pause and resume apply to the subscription as it is after the Stripe call, and refuse (409) if its status changed meanwhile",
  "app/api/staff/members/[userId]/subscription/route.ts::POST": "FIXED: the row is re-read after the provider cancel, the entitlement check is run again against it, and the new row is built from it",
  "app/api/staff/members/[userId]/extra-sessions/route.ts::POST": "PARSE-ONLY: the subscription is read after the last await",
  "app/api/staff/members/[userId]/archive/route.ts::POST": "PARSE-ONLY: the write is a targeted setUserArchived, not a stale record",
  "app/api/staff/classes/[classId]/workout/route.ts::POST": "PARSE-ONLY: writes are records built after the last await",
  "app/api/staff/gyms/[gymId]/status/route.ts::POST": "FIXED: the status is applied to the gym as it is after the body was parsed",
  "app/api/mobile/workout-review/[id]/route.ts::GET": "FIXED: only the review fields are set, on the session as it is after the AI call (updateWorkoutSession)",
  "app/api/mobile/programs/[id]/checkin/[cycle]/route.ts::GET": "FIXED: the new check-in is appended to the programme as it is after the AI call (updateTrainingProgram)",
  "app/api/mobile/programs/[id]/apply-adjustment/route.ts::POST": "FIXED: saveTrainingProgramIfUnchanged; a programme that changed meanwhile answers 409",
  "app/api/mobile/programs/[id]/exercises/[exerciseId]/swap/route.ts::POST": "FIXED: saveTrainingProgramIfUnchanged; a programme that changed meanwhile answers 409",
  "app/api/mobile/staff/nutrition/submissions/review/route.ts::POST": "FIXED: the submission status is re-checked after the (default-off) live Open Food Facts call",
  "app/api/mobile/workouts/[id]/visibility/route.ts::POST": "FIXED: only the flag is set, on the workout as it is after the body was parsed (updateWorkoutSession)",
  "app/api/mobile/community/comments/[id]/report/route.ts::POST": "PARSE-ONLY: the write is a new report record",
  "app/api/mobile/community/workouts/[id]/comments/route.ts::POST": "PARSE-ONLY: the write is a new comment record and new notifications",
  "lib/push.ts::sendPush": "PARSE-ONLY: the only writes are targeted deletes of one expired token or subscription",
};

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", ".next", "__tests__", ".git"].includes(e.name)) continue;
      walk(p);
    } else if (/\.(ts|tsx)$/.test(e.name) && p !== path.join("lib", "db.ts")) files.push(p);
  }
})(".");

const targets = files.filter((f) => /^(app[\\/]api|lib)/.test(f.replace(/^\.[\\/]/, "")));
const hits = [];
for (const f of targets) {
  const src = fs.readFileSync(f, "utf8");
  const parts = src.split(/\n(?=(?:export )?(?:async )?function |export const \w+ = async)/);
  for (const part of parts) {
    const tokens = [];
    for (const m of part.matchAll(/\bawait\b|\b(\w+)\(/g)) {
      if (m[0] === "await") tokens.push("A");
      else if (writes.has(m[1])) tokens.push("W");
      else if (reads.has(m[1])) tokens.push("R");
    }
    const s = tokens.join("");
    if (/A.*R.*A.*W/.test(s)) {
      const name = (part.match(/function (\w+)/) || [])[1] || "(anonymous)";
      hits.push({ file: f.replace(/\\/g, "/").replace(/^\.\//, ""), name, reads: (s.match(/R/g) || []).length, awaits: (s.match(/A/g) || []).length, writes: (s.match(/W/g) || []).length });
    }
  }
}
console.log(`db.ts exports: ${exported.length} (writers by name: ${writes.size}, readers: ${reads.size}); files scanned: ${targets.length}`);
console.log(`functions with: await, then a datastore read, then another await, then a datastore write (a read that can go stale before the write): ${hits.length}`);
const by = {};
for (const h of hits) by[h.file.startsWith("app/api") ? "app/api" : "lib"] = (by[h.file.startsWith("app/api") ? "app/api" : "lib"] || 0) + 1;
console.log(JSON.stringify(by));
const unreviewed = [];
for (const h of hits) {
  const key = `${h.file}::${h.name}`;
  const why = REVIEWED[key];
  if (!why) unreviewed.push(key);
  console.log(`${key}  reads=${h.reads} awaits=${h.awaits} writes=${h.writes}  ${why ? "[" + why.split(":")[0] + "]" : "[NOT REVIEWED]"}`);
}
const stale = Object.keys(REVIEWED).filter((k) => !hits.some((h) => `${h.file}::${h.name}` === k));
if (unreviewed.length) {
  console.log("");
  console.log(`NOT REVIEWED (${unreviewed.length}): add a disposition to REVIEWED, or fix the function:`);
  for (const k of unreviewed) console.log(`  ${k}`);
}
if (stale.length) {
  console.log("");
  console.log(`STALE review entries (no longer flagged, remove them): ${stale.join(", ")}`);
}
if (process.argv.includes("--check") && (unreviewed.length || stale.length)) process.exit(1);
