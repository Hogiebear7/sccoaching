import type { WorkoutReviewData } from "./workout-review";

// Feature flag — the scoring logic below is fully built and tested, but not
// yet surfaced to members. Flip this to true (and nothing else) to turn it
// on: the API route only includes `score` in its response when this is true,
// and the mobile review screen only renders the score card when the field is
// present, so there's no second toggle to remember anywhere else.
export const WORKOUT_SCORE_ENABLED = false;

export type WorkoutScoreBand = "excellent" | "solid" | "fair" | "low";

export interface WorkoutScoreComponent {
  label: string;
  points: number;
  maxPoints: number;
  detail: string;
}

export interface WorkoutScoreBreakdown {
  total: number; // 0-100
  band: WorkoutScoreBand;
  components: WorkoutScoreComponent[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function bandFor(total: number): WorkoutScoreBand {
  if (total >= 85) return "excellent";
  if (total >= 65) return "solid";
  if (total >= 45) return "fair";
  return "low";
}

// Performance vs. this same session's recent history (max 30). Widens the
// "full marks" volume band on days the body is working against real
// physiological headwinds — period/luteal phase, or any pregnancy trimester
// — rather than penalizing a dip that has a known cause. This is a tolerance
// adjustment on the comparison, not a judgment about the day itself.
function performanceScore(data: WorkoutReviewData): WorkoutScoreComponent {
  const { comparison, cyclePhase, pregnancy } = data;
  const MAX = 30;

  if (comparison.comparedSessionCount === 0 || !comparison.recentAvgVolume) {
    return {
      label: "Performance vs. recent",
      points: 20,
      maxPoints: MAX,
      detail: "No previous session with this title yet to compare against.",
    };
  }

  const wideTolerance =
    cyclePhase?.phaseLabel === "Period" || cyclePhase?.phaseLabel === "Luteal" || pregnancy?.content != null;
  const floor = wideTolerance ? 0.55 : 0.7;
  const ceiling = wideTolerance ? 0.95 : 1.1;

  const ratio = comparison.thisVolume / comparison.recentAvgVolume;
  const points = Math.round(MAX * clamp((ratio - floor) / (ceiling - floor), 0, 1));

  return {
    label: "Performance vs. recent",
    points,
    maxPoints: MAX,
    detail: `${Math.round(ratio * 100)}% of recent average volume${wideTolerance ? " (wider band applied for this day)" : ""}.`,
  };
}

// Recovery that day (max 25). Readiness score is already a 0-100 composite
// of sleep/soreness/fatigue (see lib/recovery.ts) — this just rescales it.
function recoveryScore(data: WorkoutReviewData): WorkoutScoreComponent {
  const MAX = 25;
  const readiness = data.recovery?.readinessScore ?? null;

  if (readiness === null) {
    return { label: "Recovery that day", points: 15, maxPoints: MAX, detail: "No recovery check-in logged that day." };
  }

  return {
    label: "Recovery that day",
    points: Math.round(MAX * (readiness / 100)),
    maxPoints: MAX,
    detail: `Readiness score ${readiness}/100.`,
  };
}

// Fueling that day (max 20) — how close logged calories/protein landed to
// target. Missing entirely isn't scored as zero; it's neutral, since a member
// who trains but doesn't log food shouldn't read as having eaten badly.
function nutritionScore(data: WorkoutReviewData): WorkoutScoreComponent {
  const MAX = 20;
  const n = data.nutrition;

  if (!n || !n.logged || n.targetCalories === null) {
    return { label: "Fueling that day", points: 10, maxPoints: MAX, detail: "Nothing logged for this date." };
  }

  const calRatio = n.actualCalories !== null && n.targetCalories > 0 ? n.actualCalories / n.targetCalories : null;
  const proteinRatio =
    n.actualProteinG !== null && n.targetProteinG !== null && n.targetProteinG > 0
      ? n.actualProteinG / n.targetProteinG
      : null;

  const proximity = (ratio: number | null) => (ratio === null ? 0.5 : 1 - clamp(Math.abs(1 - ratio), 0, 1));
  const avgProximity = (proximity(calRatio) + proximity(proteinRatio)) / 2;

  return {
    label: "Fueling that day",
    points: Math.round(MAX * avgProximity),
    maxPoints: MAX,
    detail: `${n.actualCalories ?? "—"} kcal / ${n.actualProteinG ?? "—"}g protein vs. target.`,
  };
}

// Hydration that day (max 10).
function hydrationScore(data: WorkoutReviewData): WorkoutScoreComponent {
  const MAX = 10;
  const h = data.hydration;

  if (!h || h.targetMl === null) {
    return { label: "Hydration that day", points: 5, maxPoints: MAX, detail: "No hydration target set." };
  }

  const ratio = clamp(h.loggedMl / h.targetMl, 0, 1);
  return {
    label: "Hydration that day",
    points: Math.round(MAX * ratio),
    maxPoints: MAX,
    detail: `${h.loggedMl}ml logged vs. ${h.targetMl}ml target.`,
  };
}

// Simply reflecting on the session (max 15) — RPE and duration are the two
// fields the post-workout prompt asks for. Credits the habit of logging
// them, independent of what the numbers say.
function reflectionScore(data: WorkoutReviewData): WorkoutScoreComponent {
  const MAX = 15;
  let points = 0;
  if (data.session.sessionRpe != null) points += 8;
  if (data.session.durationMins != null) points += 7;

  return {
    label: "Session logged in full",
    points,
    maxPoints: MAX,
    detail:
      data.session.sessionRpe != null && data.session.durationMins != null
        ? "RPE and duration both logged."
        : "RPE and/or duration weren't logged for this session.",
  };
}

export function computeWorkoutScore(data: WorkoutReviewData): WorkoutScoreBreakdown {
  const components = [
    performanceScore(data),
    recoveryScore(data),
    nutritionScore(data),
    hydrationScore(data),
    reflectionScore(data),
  ];
  const total = clamp(
    components.reduce((sum, c) => sum + c.points, 0),
    0,
    100
  );

  return { total, band: bandFor(total), components };
}
