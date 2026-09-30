// Backfills gymId onto ClassCategoryRecord/ClassRecord/ClassSeriesRecord rows
// written before that field existed. Same conventions as
// scripts/backfill-subscription-owner-gym.mjs (PR #51) — see that script's
// own header for the shared design rationale.
//
//   node scripts/backfill-class-gym-ownership.mjs --report
//   node scripts/backfill-class-gym-ownership.mjs --confirm
//
// IMPORTANT — this script is mostly a diagnostic/audit tool today, not a
// live migration: lib/db.ts's readDb() ALREADY normalizes every pre-existing
// row's missing gymId to `null` on read (the same "null = primary gym"
// convention as UserRecord.gymId and MembershipCategoryRecord.gymId — see
// each type's own comment in lib/db.ts). In the current single-gym dataset
// this normalization is provably correct, not a guess: every existing class,
// series, and category was necessarily created by the one gym that exists.
// Running --confirm today writes that same "null" value explicitly into the
// stored JSON rather than leaving it implicit — a no-op in observable
// behaviour. This script earns its keep in two ways: (1) --report gives a
// concrete audit before onboarding a second gym — did every row actually
// resolve the way "null = primary gym" assumes, or does something look
// wrong; (2) it becomes meaningfully non-trivial the moment a second gym's
// own classes/categories exist, at which point it can be re-run to confirm
// nothing was missed.
//
// Ownership is derived ONLY from authoritative existing relationships —
// never guessed, never defaulted to the primary gym just because there is
// currently one gym:
//  - classes/series: coachUserId -> the coach's own UserRecord.gymId — the
//    SAME relationship app/api/staff/classes/route.ts and every booking/
//    waitlist route already trust for gym-scoping. Every class/series in
//    this codebase is created with a coachUserId (see lib/db.ts's own
//    comment on ClassRecord.gymId) — always resolvable, never ambiguous.
//  - categories: derived from the SET of distinct gyms among the classes
//    that reference a category's slug (ClassRecord.category is a slug, not
//    an id — see ClassCategoryRecord's own comment on why the slug
//    namespace itself stays global). Exactly one distinct gym found -> that
//    gym. Zero classes reference it, or classes referencing it span MORE
//    THAN ONE gym (only possible in a genuine multi-gym dataset, impossible
//    in today's single-gym one) -> "unresolved", never guessed.
//
// Every record keeps whatever it already had — this migration only fills in
// rows where gymId is currently undefined (a key genuinely absent from the
// stored JSON, as opposed to a resolved `null`). Re-running it after a
// partial --confirm is safe and idempotent.
//
// Safety: --report is read-only and prints counts only (no class/category
// name, coach id, or gym id). Dry run by default; nothing is written
// without --confirm. The db file is backed up to <db>.bak-<ts> first.
// Set GYM_DB_PATH to target a different db file (used by tests).

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { report: false, confirm: false };
  for (const a of argv) {
    if (a === "--report") out.report = true;
    else if (a === "--confirm") out.confirm = true;
    else fail(`Unknown argument "${a}".`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.report && args.confirm) fail("--report is read-only and cannot be combined with --confirm.");
if (!existsSync(DB_PATH)) fail(`Database not found at ${DB_PATH}.`);

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));

const usersById = new Map((db.users ?? []).map((u) => [u.id, u]));

function gymForCoach(coachUserId) {
  const coach = coachUserId ? usersById.get(coachUserId) : undefined;
  if (!coach) return undefined; // no authoritative source — leave unresolved
  return coach.gymId ?? null;
}

const stats = {
  classes: { total: 0, alreadySet: 0, resolved: 0, unresolved: 0 },
  classSeries: { total: 0, alreadySet: 0, resolved: 0, unresolved: 0 },
  classCategories: { total: 0, alreadySet: 0, resolved: 0, unresolved: 0 },
};

for (const cls of db.classes ?? []) {
  stats.classes.total++;
  if (cls.gymId !== undefined) {
    stats.classes.alreadySet++;
    continue;
  }
  const gym = gymForCoach(cls.coachUserId);
  if (gym === undefined) {
    stats.classes.unresolved++;
    continue;
  }
  cls.gymId = gym;
  stats.classes.resolved++;
}

for (const series of db.classSeries ?? []) {
  stats.classSeries.total++;
  if (series.gymId !== undefined) {
    stats.classSeries.alreadySet++;
    continue;
  }
  const gym = gymForCoach(series.coachUserId);
  if (gym === undefined) {
    stats.classSeries.unresolved++;
    continue;
  }
  series.gymId = gym;
  stats.classSeries.resolved++;
}

// Built AFTER classes above are resolved in-memory, so a category's
// derivation sees each class's freshly-resolved gymId, not just
// already-set ones.
const gymsBySlug = new Map();
for (const cls of db.classes ?? []) {
  if (cls.gymId === undefined) continue; // unresolved class tells us nothing
  if (!gymsBySlug.has(cls.category)) gymsBySlug.set(cls.category, new Set());
  gymsBySlug.get(cls.category).add(cls.gymId ?? null);
}

for (const category of db.classCategories ?? []) {
  stats.classCategories.total++;
  if (category.gymId !== undefined) {
    stats.classCategories.alreadySet++;
    continue;
  }
  const distinctGyms = gymsBySlug.get(category.slug);
  if (!distinctGyms || distinctGyms.size !== 1) {
    // No classes reference it, or classes referencing it span more than one
    // gym (a genuinely shared/ambiguous category) — never guess.
    stats.classCategories.unresolved++;
    continue;
  }
  category.gymId = [...distinctGyms][0];
  stats.classCategories.resolved++;
}

console.log(`\nClass/category/series gymId backfill — ${args.confirm ? "APPLYING" : "DRY RUN"}\n`);
for (const [label, s] of Object.entries(stats)) {
  console.log(`${label}: ${s.total} total, ${s.alreadySet} already set`);
  console.log(`  newly resolved: ${s.resolved}, unresolved: ${s.unresolved}`);
}

const totalUnresolved = stats.classes.unresolved + stats.classSeries.unresolved + stats.classCategories.unresolved;
if (totalUnresolved > 0) {
  console.log(
    `\n${totalUnresolved} row(s) could not be resolved to a single authoritative gym and are left unresolved`
  );
  console.log(`(missing coachUserId/coach account, or — for categories — no classes reference it, or classes`);
  console.log(`referencing it span more than one gym). Review these manually before onboarding a second gym.`);
}

if (args.report) {
  console.log(`\nNothing written (--report).\n`);
  process.exit(0);
}
if (!args.confirm) {
  console.log(`\nNothing written. Re-run with --confirm to apply.\n`);
  process.exit(0);
}

const backup = `${DB_PATH}.bak-${Date.now()}`;
copyFileSync(DB_PATH, backup);
writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

console.log(`\n✓ Backfill applied.`);
console.log(`  Backup written: ${backup}\n`);
