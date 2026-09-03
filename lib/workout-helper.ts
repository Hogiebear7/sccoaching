import type { WorkoutSessionRecord } from "./db";
import type { Exertion } from "./nutrition";

// ─────────────────────────────────────────────────────────────────────
// Workout Helper — deterministic solo-session builder.
//
// Coaching-oriented, not medical. Prescriptions anchor to the member's
// own history when a relevant prior performance exists; otherwise they
// fall back to RPE targets. Never invents kg values.
// ─────────────────────────────────────────────────────────────────────

export type HelperTime = 20 | 30 | 45 | 60;
export type HelperEquipment = "full_gym" | "barbell" | "dumbbells" | "kettlebell" | "bodyweight";
export type HelperFocus =
  | "auto"
  | "full_body"
  | "upper"
  | "lower"
  | "strength"
  | "conditioning"
  | "recovery";

export type SessionTier = "full" | "standard" | "reduced";
export type LoadBand = "none" | "light" | "moderate" | "high";

export interface HelperContext {
  // Today's readiness score from the Recovery tab (0–100), or null when
  // the member hasn't logged recovery today.
  readinessScore: number | null;
  // Rolling 7-day training load (sum of duration × RPE from recovery logs).
  sevenDayLoad: number;
  daysWithLoad: number;
  /** Exertion already planned or booked for today, from the member's
      Weekly Training entries — including ones auto-synced from a class
      booking (see lib/weekly-training-sync.ts). Null when nothing's set
      for today. Lets the Helper avoid piling a full/standard session on
      top of a day that already has a heavy session coming, the same way
      it avoids one after a heavy 7-day load. */
  plannedTodayExertion?: Exertion | null;
}

export interface Prescription {
  kind: "history" | "rpe" | "effort";
  // e.g. "3 × 8", "3 × 30–45s", "6 × 2 min"
  scheme: string;
  // e.g. "22.5 kg", "RPE 7", "Bodyweight", "Easy pace"
  loadText: string;
  rationale: string;
  // e.g. "Last time: 3 × 8 @ 20 kg (10 Jun)" — only ever built from real history.
  reference: string | null;
}

export interface PlanExercise {
  name: string;
  prescription: Prescription;
}

export interface PlanBlock {
  title: string;
  items: PlanExercise[];
}

export interface WorkoutPlan {
  tier: SessionTier;
  tierLabel: string;
  focusLabel: string;
  rationale: string;
  loadBand: LoadBand;
  blocks: PlanBlock[];
  historyAnchoredCount: number;
  notes: string[];
}

// ─── Training-load banding ────────────────────────────────────────────
// Load = duration × RPE summed over 7 days. ~2400 is roughly five hard
// hour-long sessions in a week — treat that as an accumulated-load flag.

export function classifyLoad(sevenDayLoad: number, daysWithLoad: number): LoadBand {
  if (daysWithLoad === 0) return "none";
  if (sevenDayLoad >= 2400) return "high";
  if (sevenDayLoad >= 1000) return "moderate";
  return "light";
}

export const LOAD_BAND_LABEL: Record<LoadBand, string> = {
  none: "No data",
  light: "Light",
  moderate: "Moderate",
  high: "High",
};

// ─── Session tier decision ────────────────────────────────────────────

function decideBaseTier(context: HelperContext): { tier: SessionTier; rationale: string } {
  const band = classifyLoad(context.sevenDayLoad, context.daysWithLoad);
  const score = context.readinessScore;

  if (score === null) {
    if (band === "high") {
      return {
        tier: "reduced",
        rationale: "Your 7-day training load is high and there's no recovery log today, so the session is kept easier.",
      };
    }
    return {
      tier: "standard",
      rationale: "No recovery log today, so the session is kept moderate. Log recovery for a sharper recommendation.",
    };
  }

  if (score < 50 || band === "high") {
    const why =
      score < 50 && band === "high"
        ? `readiness is ${score} and your 7-day training load is high`
        : score < 50
        ? `readiness is ${score} today`
        : "your 7-day training load is high";
    return {
      tier: "reduced",
      rationale: `Reduced volume and intensity today — ${why}.`,
    };
  }

  if (score >= 75 && (band === "light" || band === "none" || band === "moderate")) {
    return {
      tier: "full",
      rationale: `Readiness is ${score} with a manageable week behind you — a good day for a fuller session.`,
    };
  }

  return {
    tier: "standard",
    rationale: `Readiness is ${score} with ${band === "moderate" ? "a normal" : "a manageable"} recent load — a standard session fits today.`,
  };
}

export function decideTier(context: HelperContext): { tier: SessionTier; rationale: string } {
  const base = decideBaseTier(context);

  // A "high"/"match" planned or booked session today (a class, a match) is
  // itself a hard training stimulus — stacking a full/standard Helper
  // session on top of it risks overtraining, and if the Helper is being
  // used to prep for that session later today, staying lighter leaves more
  // in the tank for it. Already-reduced stays reduced; nothing to downgrade.
  const heavyDayPlanned = context.plannedTodayExertion === "high" || context.plannedTodayExertion === "match";
  if (heavyDayPlanned && base.tier !== "reduced") {
    const downgradedTier: SessionTier = base.tier === "full" ? "standard" : "reduced";
    return {
      tier: downgradedTier,
      rationale: `${base.rationale} You've also got a heavy session booked or planned for today, so this stays lighter to leave enough in the tank for that.`,
    };
  }

  return base;
}

// ─── Movement catalogue ───────────────────────────────────────────────
// Deliberately simple, familiar movements. Options are ordered
// simplest-first per equipment; selection prefers whichever option the
// member has actually logged before.

type Pattern =
  | "squat"
  | "hinge"
  | "push_h"
  | "push_v"
  | "pull"
  | "single_leg"
  | "core";

type EquipmentOptions = Record<HelperEquipment, string[]>;

const CATALOGUE: Record<Pattern, EquipmentOptions> = {
  squat: {
    full_gym: ["Goblet Squat", "Back Squat", "Leg Press"],
    barbell: ["Back Squat", "Front Squat"],
    dumbbells: ["Goblet Squat", "Dumbbell Squat"],
    kettlebell: ["Goblet Squat"],
    bodyweight: ["Bodyweight Squat", "Tempo Squat"],
  },
  hinge: {
    full_gym: ["Romanian Deadlift", "Deadlift", "Hip Thrust"],
    barbell: ["Romanian Deadlift", "Deadlift", "Barbell Hip Thrust"],
    dumbbells: ["Dumbbell Romanian Deadlift", "Dumbbell Hip Thrust"],
    kettlebell: ["Kettlebell Deadlift", "Kettlebell Swing"],
    bodyweight: ["Glute Bridge", "Single-Leg Glute Bridge"],
  },
  push_h: {
    full_gym: ["Bench Press", "Incline Dumbbell Press", "Push-Up"],
    barbell: ["Bench Press", "Barbell Floor Press", "Push-Up"],
    dumbbells: ["Dumbbell Bench Press", "Dumbbell Floor Press", "Push-Up"],
    kettlebell: ["Kettlebell Floor Press", "Push-Up"],
    bodyweight: ["Push-Up", "Incline Push-Up"],
  },
  push_v: {
    full_gym: ["Overhead Press", "Seated Dumbbell Shoulder Press"],
    barbell: ["Overhead Press"],
    dumbbells: ["Dumbbell Shoulder Press"],
    kettlebell: ["Kettlebell Press"],
    bodyweight: ["Pike Push-Up"],
  },
  pull: {
    full_gym: ["Lat Pulldown", "Seated Cable Row", "Barbell Row"],
    barbell: ["Barbell Row", "Inverted Row"],
    dumbbells: ["One-Arm Dumbbell Row", "Chest-Supported Dumbbell Row"],
    kettlebell: ["Kettlebell Row"],
    bodyweight: ["Inverted Row", "Band Row"],
  },
  single_leg: {
    full_gym: ["Split Squat", "Walking Lunge", "Step-Up"],
    barbell: ["Barbell Split Squat", "Barbell Reverse Lunge"],
    dumbbells: ["Dumbbell Split Squat", "Dumbbell Reverse Lunge"],
    kettlebell: ["Kettlebell Reverse Lunge"],
    bodyweight: ["Reverse Lunge", "Split Squat"],
  },
  core: {
    full_gym: ["Plank", "Dead Bug", "Hanging Knee Raise"],
    barbell: ["Plank", "Dead Bug"],
    dumbbells: ["Plank", "Dead Bug"],
    kettlebell: ["Plank", "Dead Bug"],
    bodyweight: ["Plank", "Dead Bug"],
  },
};

// Movements that never take an external load prescription.
const BODYWEIGHT_ONLY = new Set(
  [
    "Push-Up", "Incline Push-Up", "Pike Push-Up", "Inverted Row", "Band Row",
    "Bodyweight Squat", "Tempo Squat", "Glute Bridge", "Single-Leg Glute Bridge",
    "Reverse Lunge", "Split Squat", "Plank", "Dead Bug", "Hanging Knee Raise",
  ].map((n) => n.toLowerCase())
);

// Time-based movements (planks etc.).
const TIMED = new Set(["plank"].map((n) => n.toLowerCase()));

// ─── History lookup ───────────────────────────────────────────────────

export interface HistoryEntry {
  date: string;
  name: string;
  weightNum: number | null;
  rawWeight: string | null;
  reps: number | null;
  sets: number | null;
  /** Reps in reserve (0-5), member self-logged — null when not recorded.
      Used by lib/training-programs.ts's progressive-overload rule; unused
      by this file's own RPE-based prescriptions. */
  rir: number | null;
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

// Flatten sessions (newest first) into per-exercise entries. Exported for
// reuse by lib/training-programs.ts's progressive-overload logic — same
// question ("what did this exercise last look like"), different caller.
export function buildHistoryIndex(sessions: WorkoutSessionRecord[]): HistoryEntry[] {
  const sorted = [...sessions].sort((a, b) => b.date.localeCompare(a.date));
  const entries: HistoryEntry[] = [];
  for (const session of sorted) {
    for (const ex of session.exercises) {
      if (!ex.name.trim()) continue;
      const parsed = ex.weight ? parseFloat(ex.weight) : NaN;
      entries.push({
        date: session.date,
        name: normalize(ex.name),
        weightNum: Number.isFinite(parsed) ? parsed : null,
        rawWeight: ex.weight,
        reps: ex.reps,
        sets: ex.sets,
        rir: typeof ex.rir === "number" ? ex.rir : null,
      });
    }
  }
  return entries;
}

// A history entry matches an option when either name contains the other
// ("Goblet Squat" ↔ "goblet squat (heavy)").
function matchesOption(entryName: string, optionName: string): boolean {
  const option = normalize(optionName);
  return entryName === option || entryName.includes(option) || option.includes(entryName);
}

export function latestEntryForOption(history: HistoryEntry[], optionName: string): HistoryEntry | null {
  for (const entry of history) {
    if (matchesOption(entry.name, optionName)) return entry;
  }
  return null;
}

// ─── Prescription ─────────────────────────────────────────────────────

const RPE_BY_TIER: Record<SessionTier, number> = { full: 8, standard: 7, reduced: 6 };

export function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function formatKg(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)} kg`;
}

function formatShortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!m || !d) return iso;
  return `${d} ${months[m - 1]}`;
}

function referenceLine(entry: HistoryEntry): string {
  const parts: string[] = [];
  if (entry.sets !== null && entry.reps !== null) parts.push(`${entry.sets} × ${entry.reps}`);
  else if (entry.reps !== null) parts.push(`× ${entry.reps}`);
  if (entry.weightNum !== null) parts.push(`@ ${formatKg(entry.weightNum)}`);
  else if (entry.rawWeight) parts.push(`@ ${entry.rawWeight}`);
  const detail = parts.length > 0 ? parts.join(" ") : "logged";
  return `Last time: ${detail} (${formatShortDate(entry.date)})`;
}

function prescribeMain(
  name: string,
  tier: SessionTier,
  history: HistoryEntry[],
  targets: { sets: number; reps: number }
): Prescription {
  const lower = normalize(name);

  if (TIMED.has(lower)) {
    return {
      kind: "effort",
      scheme: tier === "reduced" ? "2 × 30s" : "3 × 30–45s",
      loadText: "Bodyweight",
      rationale: "Hold with a straight line from shoulders to heels.",
      reference: null,
    };
  }

  const entry = latestEntryForOption(history, name);
  const bodyweightMove = BODYWEIGHT_ONLY.has(lower);

  if (bodyweightMove) {
    return {
      kind: "rpe",
      scheme: `${targets.sets} × ${targets.reps}`,
      loadText: "Bodyweight",
      rationale:
        tier === "reduced"
          ? "Stop each set well short of failure — smooth, controlled reps."
          : "Leave 2–3 reps in reserve on each set.",
      reference: entry ? referenceLine(entry) : null,
    };
  }

  // History-anchored prescription: needs a parseable weight and a rep
  // count in a similar range to today's target.
  if (entry && entry.weightNum !== null && entry.reps !== null) {
    const repsSimilar = Math.abs(entry.reps - targets.reps) <= 3;
    if (repsSimilar) {
      const reps = Math.min(Math.max(entry.reps, 5), 15);
      const step = entry.weightNum >= 20 ? 2.5 : 1;
      if (tier === "full") {
        const next = entry.weightNum + step;
        return {
          kind: "history",
          scheme: `${targets.sets} × ${reps}`,
          loadText: formatKg(next),
          rationale: `Readiness is good — nudge up from your last session by ${step} kg if the first sets feel solid.`,
          reference: referenceLine(entry),
        };
      }
      if (tier === "reduced") {
        const lighter = Math.max(roundToStep(entry.weightNum * 0.9, step), step);
        return {
          kind: "history",
          scheme: `${targets.sets} × ${reps}`,
          loadText: formatKg(lighter),
          rationale: "About 10% lighter than last time — keep it smooth today.",
          reference: referenceLine(entry),
        };
      }
      return {
        kind: "history",
        scheme: `${targets.sets} × ${reps}`,
        loadText: formatKg(entry.weightNum),
        rationale: "Repeat your last load and aim for crisp, consistent sets.",
        reference: referenceLine(entry),
      };
    }

    // History exists but at a different rep range — show it, prescribe RPE.
    return {
      kind: "rpe",
      scheme: `${targets.sets} × ${targets.reps}`,
      loadText: `RPE ${RPE_BY_TIER[tier]}`,
      rationale: "Your last log used a different rep range, so work to feel — choose a weight that leaves 2–3 reps in reserve.",
      reference: referenceLine(entry),
    };
  }

  // No usable history — RPE, never an invented weight.
  return {
    kind: "rpe",
    scheme: `${targets.sets} × ${targets.reps}`,
    loadText: `RPE ${RPE_BY_TIER[tier]}`,
    rationale: "No previous reference found — choose a weight that leaves 2–3 reps in reserve.",
    reference: null,
  };
}

// ─── Block building ───────────────────────────────────────────────────

const MAIN_TARGETS: Record<SessionTier, { sets: number; reps: number }> = {
  full: { sets: 4, reps: 6 },
  standard: { sets: 3, reps: 8 },
  reduced: { sets: 2, reps: 10 },
};

const STRENGTH_TARGETS: Record<SessionTier, { sets: number; reps: number }> = {
  full: { sets: 5, reps: 5 },
  standard: { sets: 4, reps: 6 },
  reduced: { sets: 3, reps: 6 },
};

const ACCESSORY_TARGETS: Record<SessionTier, { sets: number; reps: number }> = {
  full: { sets: 3, reps: 10 },
  standard: { sets: 3, reps: 12 },
  reduced: { sets: 2, reps: 12 },
};

interface FocusPlan {
  label: string;
  main: Pattern[];
  accessories: Pattern[];
}

const FOCUS_PLANS: Record<Exclude<HelperFocus, "auto" | "conditioning" | "recovery">, FocusPlan> = {
  full_body: {
    label: "Full body",
    main: ["squat", "push_h", "hinge", "pull"],
    accessories: ["single_leg", "push_v", "core"],
  },
  upper: {
    label: "Upper body",
    main: ["push_h", "pull", "push_v"],
    accessories: ["pull", "core", "push_h"],
  },
  lower: {
    label: "Lower body",
    main: ["squat", "hinge"],
    accessories: ["single_leg", "core", "hinge"],
  },
  strength: {
    label: "Strength",
    main: ["squat", "push_h", "hinge"],
    accessories: ["pull", "core"],
  },
};

// How many main / accessory slots fit the available time.
function slotsForTime(time: HelperTime, tier: SessionTier): { main: number; accessories: number; finisher: boolean } {
  const base =
    time >= 60
      ? { main: 3, accessories: 3, finisher: true }
      : time >= 45
      ? { main: 3, accessories: 2, finisher: false }
      : time >= 30
      ? { main: 2, accessories: 1, finisher: false }
      : { main: 2, accessories: 0, finisher: false };

  if (tier === "reduced") {
    return {
      main: base.main,
      accessories: Math.max(base.accessories - 1, 0),
      finisher: false,
    };
  }
  return base;
}

function pickExercise(
  pattern: Pattern,
  equipment: HelperEquipment,
  history: HistoryEntry[],
  used: Set<string>
): string | null {
  const options = CATALOGUE[pattern][equipment].filter((o) => !used.has(o));
  if (options.length === 0) return null;
  for (const option of options) {
    if (latestEntryForOption(history, option)) {
      used.add(option);
      return option;
    }
  }
  used.add(options[0]);
  return options[0];
}

function warmupBlock(time: HelperTime, focusLabel: string): PlanBlock {
  const items: PlanExercise[] = [
    {
      name: "Easy cardio — bike, row, or brisk walk",
      prescription: {
        kind: "effort",
        scheme: time >= 45 ? "5 min" : "3–4 min",
        loadText: "Easy pace",
        rationale: "Raise your heart rate and temperature before loading.",
        reference: null,
      },
    },
    {
      name: `Dynamic mobility — ${focusLabel.toLowerCase() === "upper body" ? "shoulders, T-spine, wrists" : "hips, ankles, T-spine"}`,
      prescription: {
        kind: "effort",
        scheme: "5–6 movements × 8 reps",
        loadText: "Bodyweight",
        rationale: "Move through the ranges you're about to train.",
        reference: null,
      },
    },
    {
      name: "Ramp-up sets on your first main lift",
      prescription: {
        kind: "effort",
        scheme: "2–3 light sets",
        loadText: "Build up",
        rationale: "Work up to your first working weight gradually.",
        reference: null,
      },
    },
  ];
  return { title: "Warm-up", items };
}

function conditioningBlocks(time: HelperTime, tier: SessionTier, equipment: HelperEquipment): PlanBlock[] {
  const rounds = tier === "reduced" ? (time >= 45 ? 5 : 4) : time >= 45 ? 8 : time >= 30 ? 6 : 4;
  const effortText = tier === "reduced" ? "RPE 6 — conversational effort" : "RPE 7 — strong but repeatable";

  const machineWork: PlanExercise = {
    name: equipment === "full_gym" ? "Row, bike, or ski intervals" : "Run, bike, or brisk hill walk intervals",
    prescription: {
      kind: "effort",
      scheme: `${rounds} × 2 min work / 1 min easy`,
      loadText: effortText,
      rationale: "Even pacing across every round beats a fast first interval.",
      reference: null,
    },
  };

  const swingOption: PlanExercise | null =
    equipment === "kettlebell"
      ? {
          name: "Kettlebell Swing",
          prescription: {
            kind: "rpe",
            scheme: `${tier === "reduced" ? 4 : 6} × 12`,
            loadText: "RPE 7",
            rationale: "Crisp hip snap, rest ~45s between sets.",
            reference: null,
          },
        }
      : null;

  const main: PlanBlock = {
    title: "Main work",
    items: swingOption ? [machineWork, swingOption] : [machineWork],
  };

  const cooldown: PlanBlock = {
    title: "Cooldown",
    items: [
      {
        name: "Easy spin or walk + light stretching",
        prescription: {
          kind: "effort",
          scheme: "5 min",
          loadText: "Easy pace",
          rationale: "Bring your heart rate down gradually.",
          reference: null,
        },
      },
    ],
  };

  return [main, cooldown];
}

function recoveryBlocks(time: HelperTime): PlanBlock[] {
  return [
    {
      title: "Main work",
      items: [
        {
          name: "Easy cardio — walk, bike, or row",
          prescription: {
            kind: "effort",
            scheme: time >= 45 ? "15–20 min" : "10–12 min",
            loadText: "Easy pace",
            rationale: "Comfortable effort — you should be able to hold a conversation.",
            reference: null,
          },
        },
        {
          name: "Mobility circuit — hips, T-spine, shoulders",
          prescription: {
            kind: "effort",
            scheme: "2 rounds × 6 movements",
            loadText: "Bodyweight",
            rationale: "Slow, controlled ranges. No forcing end range.",
            reference: null,
          },
        },
        {
          name: "Glute Bridge",
          prescription: {
            kind: "rpe",
            scheme: "2 × 12",
            loadText: "Bodyweight",
            rationale: "Easy activation work — squeeze at the top, stay far from failure.",
            reference: null,
          },
        },
      ],
    },
    {
      title: "Cooldown",
      items: [
        {
          name: "Breathing + light stretch",
          prescription: {
            kind: "effort",
            scheme: "5 min",
            loadText: "Relaxed",
            rationale: "Slow nasal breathing; let the session end quiet.",
            reference: null,
          },
        },
      ],
    },
  ];
}

// ─── Plan builder ─────────────────────────────────────────────────────

export interface BuildPlanInput {
  time: HelperTime;
  equipment: HelperEquipment;
  focus: HelperFocus;
  context: HelperContext;
  sessions: WorkoutSessionRecord[];
}

export function buildWorkoutPlan(input: BuildPlanInput): WorkoutPlan {
  const { tier, rationale } = decideTier(input.context);
  const loadBand = classifyLoad(input.context.sevenDayLoad, input.context.daysWithLoad);
  const history = buildHistoryIndex(input.sessions);
  const notes: string[] = [];

  // Resolve focus. "Auto" leans recovery-friendly when the tier is reduced.
  let focus = input.focus;
  if (focus === "auto") {
    focus = tier === "reduced" ? "recovery" : "full_body";
    if (tier === "reduced") {
      notes.push("Auto focus chose a recovery-friendly session because today's tier is reduced.");
    }
  }

  const tierLabel =
    tier === "full" ? "Full session" : tier === "standard" ? "Standard session" : "Reduced session";

  if (focus === "conditioning") {
    const blocks = [warmupBlock(input.time, "Conditioning"), ...conditioningBlocks(input.time, tier, input.equipment)];
    return {
      tier,
      tierLabel,
      focusLabel: "Conditioning",
      rationale,
      loadBand,
      blocks,
      historyAnchoredCount: 0,
      notes,
    };
  }

  if (focus === "recovery") {
    const blocks = recoveryBlocks(input.time);
    return {
      tier,
      tierLabel,
      focusLabel: "Recovery",
      rationale,
      loadBand,
      blocks,
      historyAnchoredCount: 0,
      notes,
    };
  }

  const focusPlan = FOCUS_PLANS[focus];
  const slots = slotsForTime(input.time, tier);
  const used = new Set<string>();

  const mainTargets = focus === "strength" ? STRENGTH_TARGETS[tier] : MAIN_TARGETS[tier];
  const accessoryTargets = ACCESSORY_TARGETS[tier];

  const mainItems: PlanExercise[] = [];
  for (const pattern of focusPlan.main) {
    if (mainItems.length >= slots.main) break;
    const name = pickExercise(pattern, input.equipment, history, used);
    if (!name) continue;
    mainItems.push({ name, prescription: prescribeMain(name, tier, history, mainTargets) });
  }

  const accessoryItems: PlanExercise[] = [];
  for (const pattern of focusPlan.accessories) {
    if (accessoryItems.length >= slots.accessories) break;
    const name = pickExercise(pattern, input.equipment, history, used);
    if (!name) continue;
    accessoryItems.push({ name, prescription: prescribeMain(name, tier, history, accessoryTargets) });
  }

  const blocks: PlanBlock[] = [warmupBlock(input.time, focusPlan.label)];
  blocks.push({ title: "Main work", items: mainItems });
  if (accessoryItems.length > 0) blocks.push({ title: "Accessory work", items: accessoryItems });

  if (slots.finisher) {
    blocks.push({
      title: "Finisher · optional",
      items: [
        {
          name: input.equipment === "kettlebell" ? "Kettlebell carry" : "Farmer carry or loaded walk",
          prescription: {
            kind: "effort",
            scheme: "3 × 30–40 m",
            loadText: "Heavy but controlled grip",
            rationale: "Tall posture, no leaning. Skip it if you're out of time.",
            reference: null,
          },
        },
      ],
    });
  } else if (tier === "reduced") {
    blocks.push({
      title: "Cooldown",
      items: [
        {
          name: "Easy walk + light stretching",
          prescription: {
            kind: "effort",
            scheme: "5 min",
            loadText: "Easy pace",
            rationale: "Finish easy — today is about quality, not output.",
            reference: null,
          },
        },
      ],
    });
  }

  const historyAnchoredCount = [...mainItems, ...accessoryItems].filter(
    (i) => i.prescription.kind === "history"
  ).length;

  if (history.length === 0) {
    notes.push("No training history yet — every target uses RPE. Log workouts and this gets smarter.");
  } else if (historyAnchoredCount === 0) {
    notes.push("No relevant history for today's exercises — targets use RPE instead of guessed weights.");
  }

  if (tier === "reduced") {
    notes.push("Lower volume today due to reduced readiness or a heavy training week.");
  }

  return {
    tier,
    tierLabel,
    focusLabel: focusPlan.label,
    rationale,
    loadBand,
    blocks,
    historyAnchoredCount,
    notes,
  };
}
