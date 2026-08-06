// Populates the exercise library with the coach's own starter set (from the
// gym's programming whiteboard: Knee Dominant → lower_push, Hip Dominant →
// lower_pull, Upper Push/Pull map directly, High Tempo → cardio; Core has no
// whiteboard column and keeps a small generic set). Mirrors
// lib/starter-exercise-library.ts — kept in sync manually since this script
// runs under plain Node and can't import a .ts module directly. Additive and
// idempotent — skips any name already present in the same section, so it's
// safe to re-run after staff add their own.
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

const wb = (name, section) => ({ name, section, description: "", cues: "" });

// section matches lib/db.ts's ExerciseSection union.
const STARTER_LIBRARY = [
  // Knee Dominant → lower_push
  wb("Box Squat", "lower_push"),
  wb("Bodyweight Squat", "lower_push"),
  wb("Tempo Squat", "lower_push"),
  wb("Med Ball Squat", "lower_push"),
  wb("Drop Squat", "lower_push"),
  wb("Goblet Squat", "lower_push"),
  wb("Double Dumbbell Squat", "lower_push"),
  wb("Back Squat", "lower_push"),
  wb("Front Squat", "lower_push"),
  wb("Overhead Squat", "lower_push"),
  wb("Thruster", "lower_push"),
  wb("Assisted Split Squat", "lower_push"),
  wb("Split Squat", "lower_push"),
  wb("Reverse Lunge", "lower_push"),
  wb("Forward Lunge", "lower_push"),
  wb("Walking Lunge", "lower_push"),
  wb("Bulgarian Split Squat", "lower_push"),

  // Hip Dominant → lower_pull
  wb("Bodyweight Hinge", "lower_pull"),
  wb("Med Ball Chop", "lower_pull"),
  wb("Kettlebell Deadlift", "lower_pull"),
  wb("Single-Arm Deadlift", "lower_pull"),
  wb("Suitcase Deadlift", "lower_pull"),
  wb("Kettlebell Swing", "lower_pull"),
  wb("Kettlebell Swing to High Pull", "lower_pull"),
  wb("Single-Arm Swing", "lower_pull"),
  wb("Kettlebell Overhead Swing", "lower_pull"),
  wb("Kettlebell Clean", "lower_pull"),
  wb("Kettlebell Snatch", "lower_pull"),
  wb("Dumbbell Snatch", "lower_pull"),
  wb("Kettlebell/Dumbbell Romanian Deadlift", "lower_pull"),
  wb("Side Lunge", "lower_pull"),
  wb("Reach Lunge", "lower_pull"),
  wb("Barbell Deadlift/Romanian Deadlift", "lower_pull"),
  wb("Barbell Clean", "lower_pull"),
  wb("Barbell Snatch", "lower_pull"),

  // Upper Push
  wb("Knee Push Up", "upper_push"),
  wb("Incline Push Up", "upper_push"),
  wb("Band-Assisted Push Up", "upper_push"),
  wb("Explosive Push Up", "upper_push"),
  wb("Push Up", "upper_push"),
  wb("Decline Push Up", "upper_push"),
  wb("Med Ball Push Up", "upper_push"),
  wb("Weighted/Band Push Up", "upper_push"),
  wb("Bench Press", "upper_push"),
  wb("Single-Arm Bench Press", "upper_push"),
  wb("Single-Arm Alternating Bench Press", "upper_push"),
  wb("Incline Bench Press", "upper_push"),
  wb("Dumbbell Shoulder Press", "upper_push"),
  wb("Dumbbell Curl + Press", "upper_push"),
  wb("Kettlebell Shoulder Press", "upper_push"),
  wb("Barbell Shoulder Press", "upper_push"),
  wb("Dips", "upper_push"),

  // Upper Pull
  wb("Dumbbell/Kettlebell Single-Arm Bent-Over Row", "upper_pull"),
  wb("Dumbbell/Kettlebell Single-Arm Single-Leg Row", "upper_pull"),
  wb("Face Pull", "upper_pull"),
  wb("Upright Row", "upper_pull"),
  wb("TRX Row", "upper_pull"),
  wb("Renegade Row", "upper_pull"),
  wb("Gorilla Row", "upper_pull"),
  wb("Barbell Bent-Over Row", "upper_pull"),
  wb("Pendlay Row", "upper_pull"),
  wb("Band-Assisted Pull-Up/Chin-Up", "upper_pull"),
  wb("Bodyweight Pull-Up/Chin-Up", "upper_pull"),
  wb("Single-Leg Wall Bent-Over Row", "upper_pull"),

  // High Tempo → cardio
  wb("Bike", "cardio"),
  wb("Ski Erg", "cardio"),
  wb("Row", "cardio"),
  wb("Boxing", "cardio"),
  wb("Battle Ropes", "cardio"),
  wb("Rope Pulley", "cardio"),
  wb("Overhead Slam", "cardio"),
  wb("Side-to-Side Slam", "cardio"),
  wb("Partner Slam", "cardio"),
  wb("Skipping", "cardio"),
  wb("Wall Ball", "cardio"),
  wb("Sled", "cardio"),

  // Core — no whiteboard column, kept as a small generic set.
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
