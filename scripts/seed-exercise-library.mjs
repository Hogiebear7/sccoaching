// Populates the exercise library with a starter set of common gym exercises,
// tagged by ExerciseSection so features that depend on it (Set Levels,
// exercise lookup/autocomplete) have something to resolve against from day
// one. Additive and idempotent — skips any name that already exists
// (case-insensitive), so it's safe to re-run after staff add their own.
//
//   npm run seed:exercises
//   npm run seed:exercises -- --confirm
//
// Safety:
//  - Dry run by default; nothing is written without --confirm.
//  - Backs up data/db.json to data/db.json.bak-<ts> before writing.
// Set GYM_DB_PATH to target a different db file (used by tests).

import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));
const CONFIRM = process.argv.slice(2).includes("--confirm");

if (!existsSync(DB_PATH)) {
  console.error(`✗ Database not found at ${DB_PATH}.`);
  process.exit(1);
}

// section matches lib/db.ts's ExerciseSection union.
const STARTER_LIBRARY = [
  // upper_push
  {
    name: "Bench Press",
    section: "upper_push",
    description: "Barbell press from the chest — the standard upper-body pushing strength movement.",
    cues: "Shoulder blades pinned back and down\nFeet planted, slight arch\nBar path touches low chest, drives up and slightly back",
  },
  {
    name: "Overhead Press",
    section: "upper_push",
    description: "Standing barbell or dumbbell press overhead — builds shoulder strength and trunk stability.",
    cues: "Brace the core, ribs down\nBar starts at collarbone\nPress in a straight line, head through at the top",
  },
  {
    name: "Incline Dumbbell Press",
    section: "upper_push",
    description: "Press on an inclined bench — shifts more emphasis onto the upper chest and front shoulder.",
    cues: "30–45° incline\nDumbbells track over the upper chest\nControl the lowering, don't bounce",
  },
  {
    name: "Push Up",
    section: "upper_push",
    description: "Bodyweight horizontal press — a scalable, no-equipment pushing movement.",
    cues: "Straight line from head to heels\nElbows at roughly 45° from the torso\nFull range: chest close to the floor",
  },
  {
    name: "Dip",
    section: "upper_push",
    description: "Bodyweight or weighted press on parallel bars — targets chest, triceps, and front shoulders.",
    cues: "Lean slightly forward for chest emphasis\nControl the descent to a comfortable depth\nDon't let shoulders roll forward at the bottom",
  },

  // upper_pull
  {
    name: "Pull Up",
    section: "upper_pull",
    description: "Bodyweight vertical pull — a core test of back and grip strength.",
    cues: "Start from a dead hang\nPull elbows down and back\nChin clears the bar under control",
  },
  {
    name: "Lat Pulldown",
    section: "upper_pull",
    description: "Cable vertical pull — a regressable alternative to the pull up for building the same pattern.",
    cues: "Lead with the elbows, not the hands\nAvoid leaning back excessively\nPause briefly at full contraction",
  },
  {
    name: "Barbell Row",
    section: "upper_pull",
    description: "Bent-over horizontal pull — builds the mid-back and rear shoulders.",
    cues: "Hinge at the hips, flat back\nPull to the lower ribs\nAvoid using momentum to heave the weight",
  },
  {
    name: "Seated Cable Row",
    section: "upper_pull",
    description: "Seated horizontal cable pull — controlled back-strength builder, easy to load progressively.",
    cues: "Sit tall, don't round through the pull\nDrive elbows past the ribs\nControl the return, don't let the stack slam",
  },
  {
    name: "Face Pull",
    section: "upper_pull",
    description: "Cable pull to the face — targets rear shoulders and upper back for posture and shoulder health.",
    cues: "Pull to eyebrow height\nExternally rotate at the end range\nLight weight, focus on the squeeze",
  },

  // lower_push
  {
    name: "Back Squat",
    section: "lower_push",
    description: "Barbell squat with the bar on the back — the benchmark lower-body strength movement.",
    cues: "Brace before descending\nKnees track over toes\nHips and chest rise together out of the hole",
  },
  {
    name: "Front Squat",
    section: "lower_push",
    description: "Barbell squat with the bar racked on the front shoulders — more upright torso, quad-dominant.",
    cues: "Elbows up to keep the bar racked\nStay tall through the torso\nDrive through the whole foot",
  },
  {
    name: "Leg Press",
    section: "lower_push",
    description: "Machine-based squat pattern — allows heavy loading with less balance/coordination demand.",
    cues: "Feet shoulder-width on the platform\nDon't let the lower back round at the bottom\nPress through the heels",
  },
  {
    name: "Walking Lunge",
    section: "lower_push",
    description: "Alternating forward-stepping lunge — single-leg strength, balance, and hip stability.",
    cues: "Step far enough for a 90° front knee\nBack knee lightly grazes the floor\nStay upright through the torso",
  },
  {
    name: "Bulgarian Split Squat",
    section: "lower_push",
    description: "Rear-foot-elevated single-leg squat — heavily loads one leg at a time for strength and stability.",
    cues: "Rear foot elevated behind, front foot far enough forward\nDescend under control\nMost of the weight through the front leg",
  },

  // lower_pull
  {
    name: "Deadlift",
    section: "lower_pull",
    description: "Barbell lift from the floor — a full-posterior-chain hip hinge and one of the biggest strength movements.",
    cues: "Bar over mid-foot\nFlat back, brace before the pull\nDrive the floor away, hips and shoulders rise together",
  },
  {
    name: "Romanian Deadlift",
    section: "lower_pull",
    description: "Hip-hinge from standing, minimal knee bend — targets the hamstrings and glutes.",
    cues: "Push hips back, soft knees\nBar stays close to the legs\nStop when the hamstrings feel loaded, not when the back rounds",
  },
  {
    name: "Hip Thrust",
    section: "lower_pull",
    description: "Barbell hip extension with shoulders on a bench — isolates the glutes with a big range of motion.",
    cues: "Chin tucked, ribs down\nDrive through the heels\nSqueeze glutes hard at the top, avoid over-arching",
  },
  {
    name: "Kettlebell Swing",
    section: "lower_pull",
    description: "Ballistic hip hinge — trains explosive hip extension and doubles as conditioning.",
    cues: "Hinge, don't squat\nSnap the hips forward to drive the bell\nArms are just along for the ride",
  },
  {
    name: "Good Morning",
    section: "lower_pull",
    description: "Barbell hip hinge with the bar on the back — builds hamstring and lower-back strength.",
    cues: "Soft knees, flat back\nHinge until you feel a hamstring stretch\nDrive the hips forward to stand tall",
  },

  // core
  {
    name: "Plank",
    section: "core",
    description: "Static front hold — trunk stability and anti-extension core strength.",
    cues: "Straight line from head to heels\nRibs pulled down, don't let the hips sag\nBreathe — don't hold your breath",
  },
  {
    name: "Hanging Leg Raise",
    section: "core",
    description: "Hanging from a bar, raising the legs — targets the lower abs and hip flexors.",
    cues: "Avoid swinging — control the descent\nCurl the pelvis under at the top\nStraight or bent knees depending on level",
  },
  {
    name: "Cable Woodchop",
    section: "core",
    description: "Diagonal cable pull across the body — rotational core strength.",
    cues: "Rotate through the torso, not just the arms\nKeep a slight knee bend throughout\nControl the return, don't let the stack pull you back",
  },
  {
    name: "Russian Twist",
    section: "core",
    description: "Seated rotational movement — targets the obliques.",
    cues: "Lean back to a stable angle, don't round the spine\nRotate from the ribs, not just the arms\nFeet up for more challenge, down for more control",
  },
  {
    name: "Dead Bug",
    section: "core",
    description: "Supine opposite-arm/opposite-leg reach — anti-extension core control, easy on the lower back.",
    cues: "Press the lower back into the floor throughout\nMove slowly, opposite arm and leg together\nOnly go as low as control allows",
  },

  // cardio
  {
    name: "Running",
    section: "cardio",
    description: "Steady-state or interval running — the most accessible cardiovascular conditioning tool.",
    cues: "Relaxed shoulders, arms drive front to back\nLand under the hips, not way out in front\nBreathe rhythmically",
  },
  {
    name: "Rowing",
    section: "cardio",
    description: "Full-body cardio on the rowing machine — low-impact, high output.",
    cues: "Legs, then hips, then arms on the drive\nArms, then hips, then legs on the recovery\nStay relaxed on the recovery — it's not a rush",
  },
  {
    name: "Assault Bike",
    section: "cardio",
    description: "Fan-bike cardio using arms and legs together — brutal for short, high-intensity efforts.",
    cues: "Push and pull with the arms, don't just spin the legs\nStay seated, don't bounce\nPace efforts — it rewards nothing but honest output",
  },
  {
    name: "Jump Rope",
    section: "cardio",
    description: "Skipping — cheap, portable conditioning that also builds coordination.",
    cues: "Small jumps, just enough to clear the rope\nSpin from the wrists, not the shoulders\nLand softly on the balls of the feet",
  },
  {
    name: "Stair Climber",
    section: "cardio",
    description: "Continuous stepping machine — steady cardio with a lower-body strength-endurance component.",
    cues: "Stand tall, avoid leaning on the rails\nFull foot on each step\nSteady rhythm over sprinting the first minute",
  },
];

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));
const existing = db.exercises ?? [];
const existingNames = new Set(existing.map((e) => e.name.trim().toLowerCase()));

const toAdd = STARTER_LIBRARY.filter((e) => !existingNames.has(e.name.trim().toLowerCase()));
const skipped = STARTER_LIBRARY.filter((e) => existingNames.has(e.name.trim().toLowerCase()));

console.log(`\nSeed exercise library — ${CONFIRM ? "APPLYING" : "DRY RUN"}\n`);
console.log(`Exercises to add (${toAdd.length}):`);
for (const e of toAdd) console.log(`  + ${e.name} [${e.section}]`);
if (skipped.length > 0) {
  console.log(`\nAlready present, skipped (${skipped.length}): ${skipped.map((e) => e.name).join(", ")}`);
}

if (toAdd.length === 0) {
  console.log(`\nNothing to do.\n`);
  process.exit(0);
}

if (!CONFIRM) {
  console.log(`\nNothing written. Re-run with --confirm to apply.\n`);
  process.exit(0);
}

const backup = `${DB_PATH}.bak-${Date.now()}`;
copyFileSync(DB_PATH, backup);

const now = new Date().toISOString();
db.exercises = [
  ...existing,
  ...toAdd.map((e) => ({
    id: randomUUID(),
    name: e.name,
    section: e.section,
    description: e.description,
    cues: e.cues,
    createdAt: now,
    updatedAt: now,
  })),
];

writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");

console.log(`\n✓ Added ${toAdd.length} exercise(s) to the library.`);
console.log(`  Backup written: ${backup}\n`);
