import type { ProfileRecord, TrainingDayOfWeek, WeeklyTrainingScheduleRecord } from "./profile-schema";
import type { NutritionTargetMode, RecoveryLogRecord, WorkoutSessionRecord } from "./db";
import type { DrinkSettings } from "./drink-settings";
import type { ResolvedBooking } from "./bookings";
import {
  buildDrinkMix,
  buildDrinkPlan,
  drinkDurationInfo,
  EXERTION_LABEL,
  exertionFromDayLoad,
  goalBiasFromPrimaryGoal,
  RUN_EFFORTS,
  sodiumTargetPerLitre,
  SPORT_DATA,
  weightedThreeDayLoad,
  type Exertion,
  type FuelDay,
} from "./nutrition";
import { getResolvedNutritionTarget } from "./nutrition-target-data";
import { excludedAllergensFor, recommendFoods } from "./nutrition-recommendations";
import {
  ALLERGEN_OPTIONS,
  DIETARY_PREFERENCE_OPTIONS,
  INTOLERANCE_OPTIONS,
} from "./profile-options";
import { readinessDelta } from "./progress";
import { computeRollingTrainingLoad, readinessGuidance, trainingLoadForLog } from "./recovery";
import { classifyLoad, decideTier, LOAD_BAND_LABEL, type LoadBand } from "./workout-helper";
import { activeWeeklySessions } from "./weekly-training";

// ─────────────────────────────────────────────────────────────────────
// Grounding context for the AI coach chat.
//
// Pure functions: given the member's own records, produce (a) a plain-
// text context block for the model's system prompt and (b) a small
// display summary for the chat UI. Every number the assistant may cite
// comes from here — nothing is fetched or invented downstream.
// ─────────────────────────────────────────────────────────────────────

export interface CoachingContextInput {
  profile: ProfileRecord;
  recoveryLogs: RecoveryLogRecord[];
  sessions: WorkoutSessionRecord[];
  /** ISO date (YYYY-MM-DD) treated as "today" — injectable for tests. */
  todayISO: string;
  /**
   * The member's current Sports Performance Drink calculator settings
   * (Nutrition tab), already normalized. Optional — the chat client sends
   * them so the coach can explain the member's actual mix.
   */
  drinkSettings?: DrinkSettings | null;
}

export interface CoachingContextDisplay {
  readinessScore: number | null;
  /** Today's readiness vs the most recent earlier score; null if unknown. */
  readinessDelta: number | null;
  loadBand: LoadBand;
  loadBandLabel: string;
  sessionCount: number;
  tierLabel: string;
}

export interface CoachingContext {
  text: string;
  display: CoachingContextDisplay;
}

interface FamiliarLift {
  name: string;
  timesLogged: number;
  last: { date: string; sets: number | null; reps: number | null; weight: string | null };
}

function formatSetLine(sets: number | null, reps: number | null, weight: string | null): string {
  const parts: string[] = [];
  if (sets !== null && reps !== null) parts.push(`${sets} x ${reps}`);
  else if (reps !== null) parts.push(`x ${reps}`);
  if (weight) parts.push(`@ ${weight}${/^[\d.]+$/.test(weight.trim()) ? " kg" : ""}`);
  return parts.length > 0 ? parts.join(" ") : "logged (no set detail)";
}

// Most-frequently logged exercises with their most recent performance.
export function summarizeFamiliarLifts(
  sessions: WorkoutSessionRecord[],
  limit = 8
): FamiliarLift[] {
  const sorted = [...sessions].sort((a, b) => b.date.localeCompare(a.date));
  const byName = new Map<string, FamiliarLift>();

  for (const session of sorted) {
    for (const ex of session.exercises) {
      const name = ex.name.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const existing = byName.get(key);
      if (existing) {
        existing.timesLogged += 1;
      } else {
        byName.set(key, {
          name,
          timesLogged: 1,
          last: { date: session.date, sets: ex.sets, reps: ex.reps, weight: ex.weight },
        });
      }
    }
  }

  return [...byName.values()]
    .sort((a, b) => b.timesLogged - a.timesLogged)
    .slice(0, limit);
}

const DIETARY_LABEL = new Map<string, string>(
  [...ALLERGEN_OPTIONS, ...INTOLERANCE_OPTIONS].map((o) => [o.value, o.label])
);

// Compact, model-facing dietary grounding block. REUSES the nutrition engine's
// recommendFoods + excludedAllergensFor (no rework) so the AI is handed the
// same already-filtered safe foods and hard exclusions the Nutrition tab uses.
// Backward-compatible: undefined dietary fields read as no preference / no
// restrictions. Exported so any AI helper (coach chat now; coach-summary /
// draft-reply when built out) grounds identically.
export function buildDietaryContextBlock(profile: ProfileRecord): string {
  const preference = profile.dietaryPreference ?? "standard";
  const preferenceLabel =
    DIETARY_PREFERENCE_OPTIONS.find((o) => o.value === preference)?.label ?? "No preference";
  const allergyLabels = (profile.allergies ?? []).map((k) => DIETARY_LABEL.get(k) ?? k);
  const intoleranceLabels = (profile.intolerancesOrMedical ?? []).map((k) => DIETARY_LABEL.get(k) ?? k);
  const notes = profile.dietaryNotes ?? null;

  const excludedIngredients = [...excludedAllergensFor(profile)].map((k) => DIETARY_LABEL.get(k) ?? k);
  const safe = recommendFoods(profile);

  const lines: string[] = [];
  lines.push("## Dietary requirements");
  lines.push(
    `- Preference: ${preference === "standard" ? "No specific preference" : preferenceLabel} (use only as a suggestion filter — it never permits overriding an exclusion below)`
  );
  lines.push(`- Allergies (HARD exclusions): ${allergyLabels.length ? allergyLabels.join(", ") : "none recorded"}`);
  lines.push(
    `- Intolerances / medical (HARD exclusions): ${intoleranceLabels.length ? intoleranceLabels.join(", ") : "none recorded"}`
  );
  if (notes) lines.push(`- Member's dietary notes: ${notes}`);
  lines.push(
    `- Ingredients that must NEVER appear in any food suggestion: ${excludedIngredients.length ? excludedIngredients.join(", ") : "none"}`
  );
  if (excludedIngredients.length === 0 && preference === "standard") {
    lines.push("- Safe foods to suggest from: no restrictions — standard options are all fine.");
  } else {
    lines.push("- Safe foods to suggest from (already filtered to their requirements — prefer drawing from these):");
    lines.push(`  - Protein: ${safe.protein.map((f) => f.name).join(", ") || "(none fit — suggest they speak to their coach)"}`);
    lines.push(`  - Carbs: ${safe.carb.map((f) => f.name).join(", ") || "(none fit — suggest they speak to their coach)"}`);
    lines.push(`  - Snacks: ${safe.snack.map((f) => f.name).join(", ") || "(none fit — suggest they speak to their coach)"}`);
  }
  lines.push(
    "- Rule: never recommend a food that contains an excluded ingredient or violates an allergy/intolerance above, even when the dietary preference would otherwise allow it. For medically sensitive dietary questions (e.g. coeliac, allergies, medication), keep advice general and recommend a qualified professional."
  );
  return lines.join("\n");
}

// Sports-drink grounding lines, shared by the general coach context and the
// Nutrition Coach context — same computation (lib/nutrition.ts), same
// wording, so the two assistants never describe the member's drink plan
// differently.
function buildDrinkContextLines(profile: ProfileRecord, drinkSettings: DrinkSettings): string[] {
  const s = drinkSettings;
  const cfg = SPORT_DATA[s.sport];
  const drinkInput = {
    bodyWeightKg: profile.currentWeightKg ?? 75,
    bottleMl: s.bottleMl,
    sweat: s.sweat,
    temp: s.temp,
    sport: s.sport,
    role: s.role,
    durationIdx: s.durationIdx,
    runKm: s.runKm,
    runEffort: s.runEffort,
  };
  const mix = buildDrinkMix(drinkInput);
  const plan = buildDrinkPlan(drinkInput);
  const dur = drinkDurationInfo(drinkInput);

  const lines: string[] = [];
  lines.push("## Sports performance drink (member's current calculator settings, Nutrition tab)");
  if (cfg.runMode) {
    lines.push(
      `- Session: Run — ${s.runKm} km at ${RUN_EFFORTS[s.runEffort].label.toLowerCase()} effort (estimated ${dur.mins} min)`
    );
  } else {
    lines.push(`- Session: ${cfg.label} — ${cfg.roles[s.role]?.label ?? s.role}, ${dur.mins} min`);
  }
  lines.push(`- Settings: ${s.bottleMl} ml bottle | ${s.sweat} sweat profile | ${s.temp} conditions`);
  lines.push(
    `- Mix: maltodextrin ${mix.maltodextrinG} g, beta-alanine ${mix.betaAlanineG} g, chia ${mix.chiaG} g, beetroot ${mix.beetrootG} g, orange concentrate ${mix.orangeMl} ml, salt ${mix.saltG} g`
  );
  lines.push(
    `- Totals: ${mix.carbsG} g carbs, ${mix.sodiumTotalMg} mg sodium, ${mix.nitrateMg} mg nitrate, ${mix.calories} kcal`
  );
  lines.push(
    `- How the salt dose is derived: base target ${sodiumTargetPerLitre(s.sweat, s.temp)} mg sodium per litre for this sweat profile and conditions, x duration factor ${Math.round(dur.factor * 100) / 100} (90 min = 1.0), x ${s.bottleMl / 1000} L bottle. Maltodextrin scales with body weight (0.4 g/kg per litre); beetroot with the role's or run's workload.`
  );
  lines.push(`- App's bottle/carry advice: ${plan.bottleAdvice}`);
  lines.push(`- App's drinking plan: ${plan.phases.map((p) => `${p.label} ${p.amount} (${p.tip})`).join("; ")}`);
  if (plan.extra) lines.push(`- Additional note shown to the member: ${plan.extra}`);
  return lines;
}

export function buildCoachingContext(input: CoachingContextInput): CoachingContext {
  const { profile, recoveryLogs, sessions, todayISO } = input;

  const todayLog = recoveryLogs.find((log) => log.date === todayISO);
  const readinessScore = todayLog?.readinessScore ?? null;
  const rolling = computeRollingTrainingLoad(recoveryLogs);
  const loadBand = classifyLoad(rolling.sevenDaySum, rolling.daysWithLoad);
  const tier = decideTier({
    readinessScore,
    sevenDayLoad: rolling.sevenDaySum,
    daysWithLoad: rolling.daysWithLoad,
  });

  const lines: string[] = [];

  // ── Profile ──
  lines.push("## Member profile");
  lines.push(`- Name: ${profile.fullName}`);
  lines.push(`- Primary goal: ${profile.primaryGoal}`);
  if (profile.sportPlayed) lines.push(`- Sport: ${profile.sportPlayed}`);
  if (profile.currentWeightKg !== null) lines.push(`- Current body weight: ${profile.currentWeightKg} kg`);
  lines.push(`- Preferred units: ${profile.preferredUnits ?? "metric"}`);

  // ── Dietary requirements (grounds any food/nutrition advice) ──
  lines.push("");
  lines.push(buildDietaryContextBlock(profile));

  // ── Recovery / readiness ──
  lines.push("");
  lines.push("## Today's recovery");
  if (todayLog && readinessScore !== null) {
    lines.push(`- Readiness score: ${readinessScore}/100 (logged today)`);
    if (todayLog.sleepHours !== null) lines.push(`- Sleep: ${todayLog.sleepHours} h`);
    if (todayLog.sleepQuality !== null) lines.push(`- Sleep quality: ${todayLog.sleepQuality}/10`);
    if (todayLog.soreness !== null) lines.push(`- Soreness: ${todayLog.soreness}/10 (higher = more sore)`);
    if (todayLog.fatigue !== null) lines.push(`- Fatigue: ${todayLog.fatigue}/5 (higher = more fatigued)`);
    lines.push(`- App guidance for this score: ${readinessGuidance(readinessScore)}`);
  } else {
    lines.push("- No recovery log for today. The member can log recovery in the Recovery tab.");
  }

  // ── Training load ──
  lines.push("");
  lines.push("## 7-day training load");
  if (rolling.daysWithLoad > 0) {
    lines.push(`- Load (sum of session duration x RPE over 7 days): ${rolling.sevenDaySum}`);
    lines.push(`- Days with logged load: ${rolling.daysWithLoad}`);
    lines.push(`- App classification: ${LOAD_BAND_LABEL[loadBand]} (bands: <1000 light, 1000-2399 moderate, >=2400 high)`);
  } else {
    lines.push("- No training load logged in the last 7 days.");
  }

  // ── Workout Helper decision for today ──
  lines.push("");
  lines.push("## Workout Helper — today's session tier");
  lines.push(`- Tier: ${tier.tier} (${tier.tier === "full" ? "fuller session" : tier.tier === "reduced" ? "reduced volume/intensity" : "standard session"})`);
  lines.push(`- Reason the app gives: ${tier.rationale}`);
  lines.push(
    "- The Workout Helper (Workouts tab) builds the concrete session from this tier plus the member's chosen time, equipment, and focus. Prescriptions anchor to their own last similar performance when one exists; otherwise it uses RPE targets and never invents weights."
  );

  // ── Workout history ──
  lines.push("");
  lines.push("## Workout history");
  if (sessions.length === 0) {
    lines.push("- No workouts logged yet.");
  } else {
    lines.push(`- Total sessions logged: ${sessions.length}`);
    const recent = [...sessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
    lines.push("- Most recent sessions:");
    for (const s of recent) {
      const exNames = s.exercises.map((e) => e.name).filter(Boolean).slice(0, 5);
      lines.push(
        `  - ${s.date} "${s.title}"${s.durationMins !== null ? ` (${s.durationMins} min)` : ""}${exNames.length > 0 ? `: ${exNames.join(", ")}` : ""}`
      );
    }
    const familiar = summarizeFamiliarLifts(sessions);
    if (familiar.length > 0) {
      lines.push("- Familiar lifts (most logged, with last recorded performance):");
      for (const lift of familiar) {
        lines.push(
          `  - ${lift.name} (${lift.timesLogged}x): last ${formatSetLine(lift.last.sets, lift.last.reps, lift.last.weight)} on ${lift.last.date}`
        );
      }
    }
  }

  // ── Sports performance drink (Nutrition tab calculator) ──
  if (input.drinkSettings) {
    lines.push("");
    lines.push(...buildDrinkContextLines(profile, input.drinkSettings));
  }

  return {
    text: lines.join("\n"),
    display: {
      readinessScore,
      readinessDelta: readinessDelta(recoveryLogs, todayISO),
      loadBand,
      loadBandLabel: LOAD_BAND_LABEL[loadBand],
      sessionCount: sessions.length,
      tierLabel: tier.tier === "full" ? "Full session" : tier.tier === "reduced" ? "Reduced session" : "Standard session",
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Grounding context for the Nutrition tab's AI Nutrition Coach.
//
// Deliberately separate from buildCoachingContext above: different scope
// (daily/weekly meal guidance, not training prescription), different
// grounding inputs (the Nutrition tab's own yesterday/today/tomorrow fuel
// model, not the 7-day rolling load the Workout Helper uses), and a
// distinct system prompt (see lib/ai.ts). Reuses everything it can:
// buildDietaryContextBlock and buildDrinkContextLines above, and the exact
// same fuel-day/macro math the Nutrition tab renders — nothing here
// recomputes a number the app doesn't already show the member.
// ─────────────────────────────────────────────────────────────────────

export interface NutritionCoachContextInput {
  profile: ProfileRecord;
  recoveryLogs: RecoveryLogRecord[];
  /** ISO date (YYYY-MM-DD) treated as "today" — injectable for tests. */
  todayISO: string;
  /** The member's planned exertion for tomorrow — this is a client-side
      selection on the Nutrition tab (NutritionView.tsx), not a server
      record, so the caller must supply it same as the tab does. */
  tomorrow: Exertion;
  /** The member's upcoming (not-yet-started) bookings, oldest first or in
      any order — used only to find the next one. See
      lib/bookings.ts resolveBookingsForUser. */
  upcomingBookings: ResolvedBooking[];
  /** Same optional drink-calculator settings the general coach context
      accepts — lets the Nutrition Coach explain the member's actual
      match-day drink plan when asked. */
  drinkSettings?: DrinkSettings | null;
  /** The member's self-reported recurring weekly training pattern (see
      /api/mobile/weekly-training) — captures load from activities outside
      the gym (sport practice, running club) that never touches logged
      workout data, so the coach can ground fuelling advice on days it
      would otherwise have no signal for. */
  weeklyTrainingSchedule?: WeeklyTrainingScheduleRecord | null;
}

const WEEKDAY_ORDER: TrainingDayOfWeek[] = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_LABEL: Record<TrainingDayOfWeek, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

function buildWeeklyTrainingPatternLines(schedule: WeeklyTrainingScheduleRecord | null | undefined): string[] {
  const lines: string[] = ["## Typical weekly training pattern (member's own self-reported plan, not logged data)"];

  if (!schedule || schedule.sessions.length === 0) {
    lines.push("- Not set up yet. Don't assume rest days — if it's relevant, suggest they add their weekly pattern in the app.");
    return lines;
  }

  const activeSessions = activeWeeklySessions(schedule.sessions, new Date().toISOString().slice(0, 10));
  for (const day of WEEKDAY_ORDER) {
    const sessions = activeSessions.filter((s) => s.dayOfWeek === day);
    if (sessions.length === 0) continue;
    const parts = sessions.map((s) => {
      const bits = [s.label];
      if (s.timeOfDay) bits.push(s.timeOfDay);
      if (s.intensity) bits.push(`${s.intensity} intensity`);
      return bits.join(", ");
    });
    lines.push(`- ${WEEKDAY_LABEL[day]}: ${parts.join(" · ")}`);
  }

  return lines;
}

export interface NutritionCoachContextDisplay {
  targetMode: NutritionTargetMode;
  fuelDay: FuelDay | null;
  fuelDayLabel: string | null;
  calories: number | null;
  carbGramsDay: number | null;
  proteinGramsDay: number | null;
  fatGramsDay: number | null;
  weekBand: LoadBand;
  weekBandLabel: string;
  nextSession: { title: string; date: string; category: string } | null;
}

export interface NutritionCoachContext {
  text: string;
  display: NutritionCoachContextDisplay;
}

export function buildNutritionCoachContext(input: NutritionCoachContextInput): NutritionCoachContext {
  const { profile, recoveryLogs, todayISO, tomorrow, upcomingBookings } = input;

  function isoDaysAgo(days: number): string {
    const d = new Date(`${todayISO}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  }

  // Same derivation as app/(dashboard)/dashboard/nutrition/page.tsx: real
  // logged load (duration x RPE) for yesterday/today; tomorrow is the
  // member's own plan, since the app can't know a session it hasn't seen.
  function dayLoadFor(dateISO: string): number {
    return recoveryLogs
      .filter((log) => log.date === dateISO)
      .map(trainingLoadForLog)
      .filter((load): load is number => load !== null)
      .reduce((total, load) => total + load, 0);
  }

  const yesterdayExertion = exertionFromDayLoad(dayLoadFor(isoDaysAgo(1)));
  const todayExertion = exertionFromDayLoad(dayLoadFor(todayISO));
  const load = weightedThreeDayLoad(yesterdayExertion, todayExertion, tomorrow);

  // The actual calorie/macro target — adaptive TDEE once there's enough
  // weight+diary history, cold-start estimate otherwise, or the coach's
  // manual/disabled override. Computed independently of the load/band
  // above (it derives its own day-by-day load from Recovery logs + the
  // weekly training pattern) so it always matches what the Nutrition tab
  // and Week/Day screens show — this is the single source of truth for
  // "today's target", not a recomputation from the load line above.
  const resolvedTarget = getResolvedNutritionTarget(profile.userId, todayISO, todayISO);
  const goalBias = goalBiasFromPrimaryGoal(profile.primaryGoal);
  const bodyWeightKg = resolvedTarget?.bodyWeightKg ?? profile.currentWeightKg ?? 75;

  const rolling = computeRollingTrainingLoad(recoveryLogs);
  const weekBand = classifyLoad(rolling.sevenDaySum, rolling.daysWithLoad);

  const nextBooking =
    [...upcomingBookings]
      .filter((b) => !b.isPast)
      .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`))[0] ?? null;

  const lines: string[] = [];

  lines.push("## Member profile");
  lines.push(`- Name: ${profile.fullName}`);
  lines.push(`- Primary goal: ${profile.primaryGoal}`);
  if (profile.sportPlayed) lines.push(`- Sport: ${profile.sportPlayed}`);
  lines.push(
    `- Body weight used for targets: ${bodyWeightKg} kg${
      profile.currentWeightKg === null ? " (default — no weight on file; suggest they add it in Profile for accuracy)" : ""
    }`
  );

  lines.push("");
  lines.push(buildDietaryContextBlock(profile));

  lines.push("");
  lines.push("## Training load — the Nutrition tab's yesterday / today / tomorrow model");
  lines.push(`- Yesterday: ${EXERTION_LABEL[yesterdayExertion]} (from logged training load)`);
  lines.push(`- Today: ${EXERTION_LABEL[todayExertion]} (from logged training load)`);
  lines.push(`- Tomorrow (member's own plan, set on the Nutrition tab): ${EXERTION_LABEL[tomorrow]}`);
  lines.push(
    `- Weighted 3-day load: ${load.toFixed(2)} (today weighted heaviest at 0.5, tomorrow next at 0.3, yesterday least at 0.2)`
  );
  lines.push(`- 7-day training load band (from Recovery logs): ${LOAD_BAND_LABEL[weekBand]}`);

  lines.push("");
  if (resolvedTarget?.mode === "disabled") {
    lines.push("## Daily calorie/macro target — turned off for this member");
    lines.push(
      "- Their coach has disabled automatic targets. Don't state or imply a calorie/macro number — talk qualitatively about fuelling instead."
    );
  } else if (resolvedTarget?.mode === "manual" && resolvedTarget.calories !== null) {
    lines.push("## Daily calorie/macro target — set by their coach (already computed — cite exactly, never recompute)");
    lines.push(`- Calories: ${resolvedTarget.calories} kcal`);
    lines.push(`- Protein: ${resolvedTarget.proteinG} g`);
    lines.push(`- Carbs: ${resolvedTarget.carbsG} g`);
    lines.push(`- Fat: ${resolvedTarget.fatG} g`);
    if (resolvedTarget.notes) lines.push(`- Coach's note: ${resolvedTarget.notes}`);
  } else if (resolvedTarget?.mode === "auto" && resolvedTarget.calories !== null) {
    lines.push("## Today's calorie/macro target — app-estimated (already computed — cite exactly, never recompute)");
    lines.push(`- Fuel day: ${resolvedTarget.fuelDayLabel}`);
    lines.push(
      `- Calories: ${resolvedTarget.calories} kcal (${
        resolvedTarget.source === "adaptive"
          ? "learned from their logged weight + food trend"
          : "estimated from bodyweight and training load — refines automatically as they log more weigh-ins and meals"
      })`
    );
    lines.push(`- Protein: ${resolvedTarget.proteinG} g`);
    lines.push(`- Carbs: ${resolvedTarget.carbsG} g`);
    lines.push(`- Fat: ${resolvedTarget.fatG} g`);
    if (goalBias !== "maintain") {
      lines.push(`- Adjusted for their ${profile.primaryGoal.toLowerCase()} goal.`);
    }
  } else {
    lines.push("## Daily calorie/macro target — not available yet");
    lines.push("- No weight on file, so a target can't be computed. Suggest they log their weight in Profile.");
  }

  lines.push("");
  lines.push("## Upcoming booked session");
  if (nextBooking) {
    lines.push(`- ${nextBooking.title} (category: ${nextBooking.category}) on ${nextBooking.date} at ${nextBooking.startTime}`);
    lines.push(
      "- Use this to ground next-session or match-day fuelling advice when it's relevant to what the member asks. Don't assume it's a match/game unless the title or category clearly says so — describe it plainly (e.g. \"your session on Saturday\") otherwise."
    );
  } else {
    lines.push("- No upcoming class booked. Base next-session guidance on their stated plan for tomorrow above.");
  }

  lines.push("");
  lines.push(...buildWeeklyTrainingPatternLines(input.weeklyTrainingSchedule));

  if (input.drinkSettings) {
    lines.push("");
    lines.push(...buildDrinkContextLines(profile, input.drinkSettings));
  }

  return {
    text: lines.join("\n"),
    display: {
      targetMode: resolvedTarget?.mode ?? "auto",
      fuelDay: resolvedTarget?.fuelDay as FuelDay | null,
      fuelDayLabel: resolvedTarget?.fuelDayLabel ?? null,
      calories: resolvedTarget?.calories ?? null,
      carbGramsDay: resolvedTarget?.carbsG ?? null,
      proteinGramsDay: resolvedTarget?.proteinG ?? null,
      fatGramsDay: resolvedTarget?.fatG ?? null,
      weekBand,
      weekBandLabel: LOAD_BAND_LABEL[weekBand],
      nextSession: nextBooking
        ? { title: nextBooking.title, date: nextBooking.date, category: nextBooking.category }
        : null,
    },
  };
}
