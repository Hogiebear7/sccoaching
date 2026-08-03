// Summarizes AiRedirectEventRecord counts from data/db.json — the durable
// signal for how often the general AI Coach and the AI Nutrition Coach
// redirect members to each other (see lib/db.ts's AiRedirectEventRecord and
// the two AI routes' regex-based detection at the same points).
//
// Heuristic-derived, not a classifier: each event means the coach's reply
// text matched a simple substring check, not that a human confirmed intent.
// Treat counts as directional, not exact. See docs/ai-coach-routing.md.
//
//   npm run ai-redirects
//
// Read-only — never writes to data/db.json. Set GYM_DB_PATH to target a
// different db file (used by tests), matching the other scripts here.

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));

if (!existsSync(DB_PATH)) {
  console.error(`✗ Database not found at ${DB_PATH}. Start the app once (or seed) to create it.`);
  process.exit(1);
}

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));
const events = db.aiRedirectEvents ?? [];

if (events.length === 0) {
  console.log("No AI redirect events recorded yet.");
  process.exit(0);
}

// ISO week key (e.g. "2026-W31") — good enough for a rough trend view;
// doesn't need to be exact to the ISO 8601 week-numbering spec.
function isoWeekKey(dateStr) {
  const d = new Date(dateStr);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const totals = { coach_to_nutrition: 0, nutrition_to_coach: 0 };
const byWeek = new Map(); // week -> { coach_to_nutrition, nutrition_to_coach }

for (const e of events) {
  if (e.direction in totals) totals[e.direction] += 1;

  const week = isoWeekKey(e.createdAt);
  const row = byWeek.get(week) ?? { coach_to_nutrition: 0, nutrition_to_coach: 0 };
  if (e.direction in row) row[e.direction] += 1;
  byWeek.set(week, row);
}

console.log(`AI coach-routing redirects — ${events.length} total event(s)\n`);
console.log("Totals:");
console.log(`  AI Coach → Nutrition Coach:  ${totals.coach_to_nutrition}`);
console.log(`  Nutrition Coach → AI Coach:  ${totals.nutrition_to_coach}`);

console.log("\nBy week:");
console.log("  week      coach→nutrition   nutrition→coach");
for (const week of [...byWeek.keys()].sort()) {
  const row = byWeek.get(week);
  console.log(
    `  ${week}   ${String(row.coach_to_nutrition).padStart(15)}   ${String(row.nutrition_to_coach).padStart(15)}`
  );
}
