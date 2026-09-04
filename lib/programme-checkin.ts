// Builds the real, logged-data context for one cycle's end-of-week AI
// check-in — mirrors lib/workout-review.ts's role for the single-workout
// review (deterministic data assembly, kept separate from the AI call
// itself in lib/ai.ts's generateProgrammeCheckIn).

import { type TrainingProgramRecord, type WorkoutSessionRecord } from "./db";
import { buildHistoryIndex, type HistoryEntry } from "./workout-helper";

export interface ProgrammeCheckInExerciseTrend {
  name: string;
  rir: number | null;
  hitTarget: boolean | null;
}

export interface ProgrammeCheckInComparison {
  exerciseName: string;
  baselineDate: string;
  baselineValue: string;
  retestDate: string;
  retestValue: string;
}

export interface ProgrammeCheckInData {
  programName: string;
  goal: string;
  cycleIndex: number;
  weekNumber: number;
  totalWeeks: number | null;
  cycleWindow: { startedAt: string; endedAt: string } | null;
  sessionsLoggedThisCycle: number;
  workoutDaysInCycle: number;
  adherencePct: number | null;
  exerciseTrends: ProgrammeCheckInExerciseTrend[];
  checkpointComparison: ProgrammeCheckInComparison | null;
}

function inWindow(date: string, startedAt: string, endedAt: string): boolean {
  return date >= startedAt.slice(0, 10) && date <= endedAt.slice(0, 10);
}

function formatEntry(entry: HistoryEntry): string {
  const parts: string[] = [];
  if (entry.weightNum !== null) parts.push(`${entry.weightNum}kg`);
  if (entry.reps !== null) parts.push(`${entry.reps} reps`);
  if (entry.sets !== null) parts.push(`${entry.sets} sets`);
  return parts.length > 0 ? parts.join(" x ") : (entry.rawWeight ?? "logged");
}

export function buildProgrammeCheckInData(
  program: TrainingProgramRecord,
  sessions: WorkoutSessionRecord[],
  cycleIndex: number
): ProgrammeCheckInData {
  const summary = (program.cycleSummaries ?? []).find((c) => c.cycleIndex === cycleIndex) ?? null;
  const cycleWindow = summary ? { startedAt: summary.startedAt, endedAt: summary.endedAt } : null;

  const sessionsThisCycle = cycleWindow
    ? sessions.filter((s) => inWindow(s.date, cycleWindow.startedAt, cycleWindow.endedAt))
    : [];
  const workoutDays = program.days.filter((d) => d.type === "workout");

  const exerciseTrends: ProgrammeCheckInExerciseTrend[] = workoutDays.flatMap((day) =>
    day.exercises.map((ex) => {
      const nameKey = ex.name.trim().toLowerCase();
      const entry = sessionsThisCycle
        .flatMap((s) => s.exercises.map((e) => ({ ...e, date: s.date })))
        .filter((e) => e.name.trim().toLowerCase() === nameKey)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      return {
        name: ex.name,
        rir: entry && typeof entry.rir === "number" ? entry.rir : null,
        hitTarget: entry ? entry.reps !== null : null,
      };
    })
  );

  // Checkpoint retest comparison — only when the checkpoint due THIS week
  // shares an exercise name with an earlier checkpoint. Relies on the same
  // "reuse the exact exercise name for a retest" instruction given to the
  // AI at generation time (see PROGRAMME_SKELETON_SYSTEM_PROMPT in
  // lib/ai.ts) — same name-based matching already used for progressive
  // overload, not a new mechanism.
  const weekNumber = cycleIndex + 1;
  const checkpoints = [...(program.testCheckpoints ?? [])].sort((a, b) => a.weekNumber - b.weekNumber);
  const dueCheckpoint = checkpoints.find((c) => c.weekNumber === weekNumber) ?? null;
  const earlierCheckpoints = checkpoints.filter((c) => c.weekNumber < weekNumber);

  let checkpointComparison: ProgrammeCheckInComparison | null = null;
  if (dueCheckpoint) {
    for (const ex of dueCheckpoint.day.exercises) {
      const nameKey = ex.name.trim().toLowerCase();
      const wasTestedBefore = earlierCheckpoints.some((c) =>
        c.day.exercises.some((e) => e.name.trim().toLowerCase() === nameKey)
      );
      if (!wasTestedBefore) continue;

      const matches = buildHistoryIndex(sessions).filter((e) => e.name === nameKey);
      if (matches.length < 2) continue;
      const sortedAsc = [...matches].sort((a, b) => a.date.localeCompare(b.date));
      const baseline = sortedAsc[0];
      const retest = sortedAsc[sortedAsc.length - 1];
      if (baseline.date === retest.date) continue;

      checkpointComparison = {
        exerciseName: ex.name,
        baselineDate: baseline.date,
        baselineValue: formatEntry(baseline),
        retestDate: retest.date,
        retestValue: formatEntry(retest),
      };
      break; // one comparison gives the AI enough to reason about pace
    }
  }

  return {
    programName: program.name,
    goal: program.aiMeta?.goal ?? "general fitness",
    cycleIndex,
    weekNumber,
    totalWeeks: program.totalWeeks ?? null,
    cycleWindow,
    sessionsLoggedThisCycle: sessionsThisCycle.length,
    workoutDaysInCycle: workoutDays.length,
    adherencePct:
      workoutDays.length > 0 ? Math.min(100, Math.round((sessionsThisCycle.length / workoutDays.length) * 100)) : null,
    exerciseTrends,
    checkpointComparison,
  };
}

export function formatProgrammeCheckInContext(data: ProgrammeCheckInData): string {
  const lines = [
    `Programme: ${data.programName}`,
    `Goal: ${data.goal}`,
    `Week ${data.weekNumber}${data.totalWeeks ? ` of ${data.totalWeeks}` : ""} — cycle ${data.cycleIndex + 1} just completed.`,
  ];

  lines.push(
    data.adherencePct !== null
      ? `Adherence: ${data.sessionsLoggedThisCycle}/${data.workoutDaysInCycle} workout days logged this cycle (${data.adherencePct}%).`
      : "Adherence: not enough data to compute this cycle."
  );

  if (data.exerciseTrends.length > 0) {
    lines.push("Exercise trends this cycle (RIR = reps in reserve, 0-5, low = near failure, null = not logged):");
    for (const t of data.exerciseTrends) {
      lines.push(`- ${t.name}: ${t.rir !== null ? `RIR ${t.rir}` : "not logged"}${t.hitTarget === false ? ", missed target reps" : ""}`);
    }
  }

  lines.push(
    data.checkpointComparison
      ? `Checkpoint retest available — ${data.checkpointComparison.exerciseName}: baseline ${data.checkpointComparison.baselineValue} (${data.checkpointComparison.baselineDate}) vs retest ${data.checkpointComparison.retestValue} (${data.checkpointComparison.retestDate}).`
      : "No checkpoint retest comparison available this cycle."
  );

  return lines.join("\n");
}
