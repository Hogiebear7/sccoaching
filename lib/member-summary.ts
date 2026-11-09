// What a coach sees about a member (owner request, 2026-11-08): a full summary on the member's profile, and a compact "state of the member" brief when a coach
// taps a member's name on a class roster. Both are worked out here, deterministically, from what the member logs (training, check-ins, nutrition, water,
// weight, classes): no AI call, so no cost and no invention. Only ever built for a member who holds a gym Membership (the staff data wall,
// lib/member-tier-wall.ts); the routes check that, this module does not.
import { currentHealthNote, mentionsIllnessOrInjury } from "./health-note";
import { workoutVolumeKg } from "./member-stats";
import type { BodyWeightLogRecord, RecoveryLogRecord, WorkoutSessionRecord } from "./db";

const DAY_MS = 86_400_000;

export interface SummaryBooking {
  date: string;
  startTime: string;
  title: string;
  attended: boolean;
  /** The no-show job has run on it and the member never checked in. */
  missed: boolean;
  upcoming: boolean;
}

export interface SummaryInputs {
  todayISO: string;
  fullName: string | null;
  primaryGoal: string | null;
  trainingDaysPerWeek: number | null;
  goalWeightKg: number | null;
  goalTargetDate: string | null;
  sessions: WorkoutSessionRecord[];
  bookings: SummaryBooking[];
  recoveryLogs: RecoveryLogRecord[];
  /** Calories and protein actually logged, per date (only dates with at least one entry). */
  foodByDate: Record<string, { calories: number; proteinG: number }>;
  targetCalories: number | null;
  targetProteinG: number | null;
  /** Water logged, per date, in ml (only dates with a log). */
  waterByDate: Record<string, number>;
  weightLogs: BodyWeightLogRecord[];
}

export type FlagSeverity = "caution" | "note";
export interface SummaryFlag {
  code: "health_note" | "low_readiness" | "load_spike" | "no_recent_training" | "low_sleep" | "low_nutrition" | "low_protein" | "low_hydration" | "missed_classes";
  severity: FlagSeverity;
  text: string;
}

export type Effort = "none" | "easy" | "moderate" | "hard";

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const daysAgoISO = (todayISO: string, n: number) => iso(Date.parse(`${todayISO}T00:00:00.000Z`) - n * DAY_MS);
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / DAY_MS);
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
const r0 = (n: number | null) => (n === null ? null : Math.round(n));
const inWindow = (date: string, todayISO: string, fromDaysAgo: number, toDaysAgo = 0) => date <= daysAgoISO(todayISO, toDaysAgo) && date >= daysAgoISO(todayISO, fromDaysAgo);

// ── Training ───────────────────────────────────────────────────────────────

export function trainingSummary(sessions: WorkoutSessionRecord[], todayISO: string, trainingDaysPerWeek: number | null) {
  const sorted = [...sessions].sort((a, b) => b.date.localeCompare(a.date));
  const last = sorted[0] ?? null;
  const within = (from: number, to = 0) => sorted.filter((s) => inWindow(s.date, todayISO, from, to));
  const days = (list: WorkoutSessionRecord[]) => new Set(list.map((s) => s.date)).size;
  const volume = (list: WorkoutSessionRecord[]) => list.reduce((sum, s) => sum + workoutVolumeKg(s), 0);

  const last7 = within(6);
  const last3 = within(2);
  const last30 = within(29);
  const prior28 = within(34, 7); // the four weeks before the last 7 days
  const priorWeeklyVolume = prior28.length ? volume(prior28) / 4 : 0;
  const volume7 = volume(last7);
  const rpes3 = last3.map((s) => s.sessionRpe).filter((v): v is number => typeof v === "number");
  const rpes7 = last7.map((s) => s.sessionRpe).filter((v): v is number => typeof v === "number");

  let effort3: Effort = "none";
  if (last3.length > 0) {
    const rpe = avg(rpes3);
    if (rpe !== null) effort3 = rpe >= 7.5 ? "hard" : rpe >= 5.5 ? "moderate" : "easy";
    else {
      // No RPE logged: judge by volume against the member's own usual session.
      const usual = avg(prior28.map(workoutVolumeKg).filter((v) => v > 0));
      const now = avg(last3.map(workoutVolumeKg));
      effort3 = usual && now !== null ? (now > usual * 1.3 ? "hard" : now < usual * 0.7 ? "easy" : "moderate") : "moderate";
    }
  }

  return {
    totalLogged: sorted.length,
    lastSessionDate: last?.date ?? null,
    daysSinceLastSession: last ? Math.max(0, diffDays(last.date, todayISO)) : null,
    daysTrainedLast3: days(last3),
    daysTrainedLast7: days(last7),
    daysTrainedLast30: days(last30),
    targetDaysPerWeek: trainingDaysPerWeek,
    volumeLast7Kg: Math.round(volume7),
    averageWeeklyVolumePrev4WeeksKg: Math.round(priorWeeklyVolume),
    loadSpike: priorWeeklyVolume > 0 && volume7 > priorWeeklyVolume * 1.5,
    averageSessionRpeLast7: r1(avg(rpes7)),
    effortLast3Days: effort3,
    recent: sorted.slice(0, 8).map((s) => ({
      date: s.date,
      title: s.title,
      durationMins: s.durationMins ?? null,
      volumeKg: Math.round(workoutVolumeKg(s)),
      rpe: s.sessionRpe ?? null,
    })),
  };
}

// ── Classes ────────────────────────────────────────────────────────────────

export function classSummary(bookings: SummaryBooking[], todayISO: string) {
  const past = bookings.filter((b) => !b.upcoming && inWindow(b.date, todayISO, 29));
  const sortedPast = [...past].sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));
  const recent6 = sortedPast.slice(0, 6);
  const upcoming = bookings
    .filter((b) => b.upcoming)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const lastAttended = [...bookings].filter((b) => b.attended).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  return {
    bookedLast30: past.length,
    attendedLast30: past.filter((b) => b.attended).length,
    missedLast30: past.filter((b) => b.missed).length,
    attendedOfLast6: recent6.filter((b) => b.attended).length,
    missedOfLast6: recent6.filter((b) => b.missed).length,
    lastAttendedDate: lastAttended?.date ?? null,
    upcoming: upcoming.slice(0, 5).map((b) => ({ date: b.date, startTime: b.startTime, title: b.title })),
  };
}

// ── Check-ins ──────────────────────────────────────────────────────────────

export function checkInSummary(logs: RecoveryLogRecord[], todayISO: string) {
  const recent = logs.filter((l) => inWindow(l.date, todayISO, 13)).sort((a, b) => b.date.localeCompare(a.date));
  const latest = recent[0] ?? null;
  const readings = (pick: (l: RecoveryLogRecord) => number | null) => recent.map(pick).filter((v): v is number => v !== null);
  const scores = recent.slice().reverse().map((l) => l.readinessScore).filter((v): v is number => v !== null);
  const half = Math.floor(scores.length / 2);
  const earlier = avg(scores.slice(0, half));
  const later = avg(scores.slice(half));
  const current = currentHealthNote(logs, todayISO);
  return {
    checkInsLast14: recent.length,
    latestDate: latest?.date ?? null,
    daysSinceLatest: latest ? Math.max(0, diffDays(latest.date, todayISO)) : null,
    latest: latest
      ? { readiness: latest.readinessScore, sleepHours: latest.sleepHours, sleepQuality: latest.sleepQuality, soreness: latest.soreness, fatigue: latest.fatigue }
      : null,
    averageReadiness: r0(avg(readings((l) => l.readinessScore))),
    averageSleepHours: r1(avg(readings((l) => l.sleepHours))),
    averageSoreness: r1(avg(readings((l) => l.soreness))),
    averageFatigue: r1(avg(readings((l) => l.fatigue))),
    readinessTrend: earlier !== null && later !== null && scores.length >= 4 ? (later - earlier > 5 ? "improving" : earlier - later > 5 ? "declining" : "steady") : null,
    healthNote: current
      ? { note: current.note, date: current.date, ageDays: current.ageDays, mentionsIllnessOrInjury: mentionsIllnessOrInjury(current.note) }
      : null,
  };
}

// ── Nutrition and water ────────────────────────────────────────────────────

export function nutritionSummary(inputs: Pick<SummaryInputs, "foodByDate" | "waterByDate" | "targetCalories" | "targetProteinG" | "todayISO">) {
  const { foodByDate, waterByDate, targetCalories, targetProteinG, todayISO } = inputs;
  // The last 3 COMPLETED days (today is still in progress, so it isn't held against anyone).
  const dates = [1, 2, 3].map((n) => daysAgoISO(todayISO, n));
  const foodDays = dates.filter((d) => foodByDate[d]);
  const calories = avg(foodDays.map((d) => foodByDate[d].calories));
  const protein = avg(foodDays.map((d) => foodByDate[d].proteinG));
  const waterDays = dates.filter((d) => waterByDate[d] !== undefined);
  const water = avg(waterDays.map((d) => waterByDate[d]));
  const last7Food = [...Array(7)].map((_, i) => daysAgoISO(todayISO, i)).filter((d) => foodByDate[d]);
  return {
    daysLoggedLast3: foodDays.length,
    daysLoggedLast7: last7Food.length,
    averageCalories: r0(calories),
    targetCalories,
    caloriePercentOfTarget: calories !== null && targetCalories ? Math.round((calories / targetCalories) * 100) : null,
    averageProteinG: r0(protein),
    targetProteinG,
    proteinPercentOfTarget: protein !== null && targetProteinG ? Math.round((protein / targetProteinG) * 100) : null,
    waterDaysLoggedLast3: waterDays.length,
    averageWaterMl: r0(water),
  };
}

// ── Weight ─────────────────────────────────────────────────────────────────

export function weightSummary(logs: BodyWeightLogRecord[], todayISO: string, goalWeightKg: number | null, goalTargetDate: string | null) {
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1] ?? null;
  const within90 = sorted.filter((l) => inWindow(l.date, todayISO, 90));
  const first90 = within90[0] ?? null;
  const target30 = daysAgoISO(todayISO, 30);
  // Closest weigh-in on or before 30 days ago, if there is one.
  const thirtyAgo = [...sorted].reverse().find((l) => l.date <= target30) ?? null;
  const change = (from: BodyWeightLogRecord | null) => (latest && from && from.id !== latest.id ? r1(latest.weightKg - from.weightKg) : null);
  const goalDelta = latest && goalWeightKg !== null ? r1(goalWeightKg - latest.weightKg) : null;
  return {
    latestKg: latest?.weightKg ?? null,
    latestDate: latest?.date ?? null,
    changeLast30DaysKg: change(thirtyAgo),
    changeLast90DaysKg: change(first90),
    weighInsLast90: within90.length,
    goalWeightKg,
    goalTargetDate,
    kgToGoal: goalDelta,
  };
}

// ── Flags and the one-line state ───────────────────────────────────────────

export type MemberState = "good" | "take_care" | "caution" | "no_recent_data";

export function memberFlags(parts: {
  training: ReturnType<typeof trainingSummary>;
  classes: ReturnType<typeof classSummary>;
  checkIns: ReturnType<typeof checkInSummary>;
  nutrition: ReturnType<typeof nutritionSummary>;
}): SummaryFlag[] {
  const { training, classes, checkIns, nutrition } = parts;
  const flags: SummaryFlag[] = [];

  if (checkIns.healthNote) {
    const n = checkIns.healthNote;
    flags.push({
      code: "health_note",
      severity: n.mentionsIllnessOrInjury ? "caution" : "note",
      text: `Wrote in their check-in ${n.ageDays === 0 ? "today" : n.ageDays === 1 ? "yesterday" : `${n.ageDays} days ago`}: "${n.note}"`,
    });
  }
  const readiness = checkIns.latest?.readiness ?? null;
  if (readiness !== null && (checkIns.daysSinceLatest ?? 99) <= 2) {
    if (readiness < 50) flags.push({ code: "low_readiness", severity: "caution", text: `Readiness is low (${readiness}/100).` });
    else if (readiness < 65) flags.push({ code: "low_readiness", severity: "note", text: `Readiness is below par (${readiness}/100).` });
  }
  if (training.loadSpike) {
    flags.push({ code: "load_spike", severity: "caution", text: "Training load this week is well above their recent average." });
  }
  if (training.totalLogged > 0 && (training.daysSinceLastSession ?? 0) >= 7) {
    flags.push({ code: "no_recent_training", severity: "note", text: `No logged training for ${training.daysSinceLastSession} days.` });
  }
  if (checkIns.averageSleepHours !== null && checkIns.averageSleepHours < 6) {
    flags.push({ code: "low_sleep", severity: "note", text: `Sleeping about ${checkIns.averageSleepHours} h a night.` });
  }
  if (nutrition.caloriePercentOfTarget !== null && nutrition.daysLoggedLast3 >= 2 && nutrition.caloriePercentOfTarget < 70) {
    flags.push({ code: "low_nutrition", severity: "note", text: `Eating about ${nutrition.caloriePercentOfTarget}% of their calorie target.` });
  }
  if (nutrition.proteinPercentOfTarget !== null && nutrition.daysLoggedLast3 >= 2 && nutrition.proteinPercentOfTarget < 70) {
    flags.push({ code: "low_protein", severity: "note", text: `Protein is about ${nutrition.proteinPercentOfTarget}% of target.` });
  }
  if (nutrition.averageWaterMl !== null && nutrition.averageWaterMl < 1200) {
    flags.push({ code: "low_hydration", severity: "note", text: `Water logged is low (about ${(nutrition.averageWaterMl / 1000).toFixed(1)} L a day).` });
  }
  if (classes.missedOfLast6 >= 2) {
    flags.push({ code: "missed_classes", severity: "note", text: `Missed ${classes.missedOfLast6} of their last ${Math.min(6, classes.bookedLast30)} booked classes.` });
  }
  return flags;
}

export function memberState(flags: SummaryFlag[], hasAnyRecentData: boolean): MemberState {
  if (flags.some((f) => f.severity === "caution")) return "caution";
  if (!hasAnyRecentData) return "no_recent_data";
  return flags.length >= 2 ? "take_care" : "good";
}

// ── The two outputs ────────────────────────────────────────────────────────

export function buildMemberSummary(inputs: SummaryInputs) {
  const training = trainingSummary(inputs.sessions, inputs.todayISO, inputs.trainingDaysPerWeek);
  const classes = classSummary(inputs.bookings, inputs.todayISO);
  const checkIns = checkInSummary(inputs.recoveryLogs, inputs.todayISO);
  const nutrition = nutritionSummary(inputs);
  const weight = weightSummary(inputs.weightLogs, inputs.todayISO, inputs.goalWeightKg, inputs.goalTargetDate);
  const flags = memberFlags({ training, classes, checkIns, nutrition });
  const hasAnyRecentData = training.daysTrainedLast30 > 0 || checkIns.checkInsLast14 > 0 || nutrition.daysLoggedLast7 > 0;
  return {
    asOf: inputs.todayISO,
    name: inputs.fullName,
    goal: inputs.primaryGoal,
    state: memberState(flags, hasAnyRecentData),
    flags,
    training,
    classes,
    checkIns,
    nutrition,
    weight,
  };
}

const EFFORT_WORD: Record<Effort, string> = { none: "no training", easy: "easy", moderate: "moderate", hard: "hard" };

/** The compact version for a coach about to take a class: state, then a few plain lines. */
export function buildClassBrief(inputs: SummaryInputs) {
  const s = buildMemberSummary(inputs);
  const { training, checkIns, nutrition, classes } = s;
  const lines: string[] = [];

  if (training.totalLogged === 0) lines.push("No training logged yet.");
  else {
    const effort = training.effortLast3Days === "none" ? "" : `, ${EFFORT_WORD[training.effortLast3Days]} effort`;
    lines.push(
      `Trained ${training.daysTrainedLast7} day${training.daysTrainedLast7 === 1 ? "" : "s"} in the last 7 (${training.daysTrainedLast3} in the last 3${effort}).` +
        (training.daysSinceLastSession !== null && training.daysTrainedLast3 === 0
          ? ` Last session ${training.daysSinceLastSession === 0 ? "today" : `${training.daysSinceLastSession} day${training.daysSinceLastSession === 1 ? "" : "s"} ago`}.`
          : "")
    );
  }

  if (checkIns.latest && (checkIns.daysSinceLatest ?? 99) <= 3) {
    const l = checkIns.latest;
    const when = checkIns.daysSinceLatest === 0 ? "Today's" : checkIns.daysSinceLatest === 1 ? "Yesterday's" : "Latest";
    lines.push(
      `${when} check-in: readiness ${l.readiness ?? "n/a"}/100, slept ${l.sleepHours ?? "n/a"} h, soreness ${l.soreness ?? "n/a"}/10, fatigue ${l.fatigue ?? "n/a"}/5.`
    );
  } else {
    lines.push("No check-in in the last 3 days.");
  }

  if (nutrition.daysLoggedLast3 === 0) lines.push("Food not logged in the last 3 days.");
  else {
    const kcal = nutrition.caloriePercentOfTarget !== null ? `${nutrition.caloriePercentOfTarget}% of calorie target` : `about ${nutrition.averageCalories} kcal a day`;
    const prot = nutrition.proteinPercentOfTarget !== null ? `, protein ${nutrition.proteinPercentOfTarget}% of target` : "";
    lines.push(`Eating (last 3 days, ${nutrition.daysLoggedLast3} logged): ${kcal}${prot}.`);
  }
  lines.push(
    nutrition.averageWaterMl === null
      ? "Water not logged in the last 3 days."
      : `Water about ${(nutrition.averageWaterMl / 1000).toFixed(1)} L a day (last 3 days).`
  );

  if (classes.bookedLast30 > 0) lines.push(`Classes: attended ${classes.attendedOfLast6} of their last ${Math.min(6, classes.bookedLast30)} booked.`);

  return { asOf: s.asOf, name: s.name, state: s.state, flags: s.flags, lines, healthNote: checkIns.healthNote };
}
