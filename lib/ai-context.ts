import type { ProfileRecord } from "./profile-schema";
import type { RecoveryLogRecord, WorkoutSessionRecord } from "./db";
import type { DrinkSettings } from "./drink-settings";
import {
  buildDrinkMix,
  buildDrinkPlan,
  drinkDurationInfo,
  RUN_EFFORTS,
  sodiumTargetPerLitre,
  SPORT_DATA,
} from "./nutrition";
import { excludedAllergensFor, recommendFoods } from "./nutrition-recommendations";
import {
  ALLERGEN_OPTIONS,
  DIETARY_PREFERENCE_OPTIONS,
  INTOLERANCE_OPTIONS,
} from "./profile-options";
import { readinessDelta } from "./progress";
import { computeRollingTrainingLoad, readinessGuidance } from "./recovery";
import { classifyLoad, decideTier, LOAD_BAND_LABEL, type LoadBand } from "./workout-helper";

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
    const s = input.drinkSettings;
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

    lines.push("");
    lines.push("## Sports performance drink (member's current calculator settings, Nutrition tab)");
    if (cfg.runMode) {
      lines.push(
        `- Session: Run — ${s.runKm} km at ${RUN_EFFORTS[s.runEffort].label.toLowerCase()} effort (estimated ${dur.mins} min)`
      );
    } else {
      lines.push(
        `- Session: ${cfg.label} — ${cfg.roles[s.role]?.label ?? s.role}, ${dur.mins} min`
      );
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
    lines.push(
      `- App's drinking plan: ${plan.phases.map((p) => `${p.label} ${p.amount} (${p.tip})`).join("; ")}`
    );
    if (plan.extra) lines.push(`- Additional note shown to the member: ${plan.extra}`);
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
