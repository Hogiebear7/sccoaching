import { randomUUID } from "crypto";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { generateProgrammeSkeleton, isAiConfigured, type ProgrammeConditioningProtocol } from "@/lib/ai";
import { findUserById, findWeeklyTrainingScheduleByUserId, findWorkoutSessionsByUserId, type PrescribedExercise } from "@/lib/db";
import { getExerciseLibraryClient } from "@/lib/exercise-library/admin-client";
import { mapExerciseRow } from "@/lib/exercise-library/mappers";
import { hasAccess } from "@/lib/member-access";
import { resolveMemberTierForUser } from "@/lib/membership-entitlement";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { pickExercisesForDay, pickStructuredExercisesForDay, resolveSplitMode } from "@/lib/programme-exercise-picker";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  buildTestCheckpoints,
  computeCheckpointWeeks,
  parseProgramDays,
  resolveInitialProgrammeTargets,
  type ProgrammeRepScheme,
} from "@/lib/training-programs";

// Heavier cost than a photo scan (a full skeleton + per-day exercise
// resolution), so a tighter budget than the other AI features' 15/10min.
const GENERATE_RATE_LIMIT = 5;
const GENERATE_RATE_WINDOW_MS = 60 * 60 * 1000;

// 4/8/12 are the mobile UI's fast-default presets, but any whole-number
// length in this range is valid — the mobile custom-end-date picker (see
// workout-generator.tsx's weeksUntil) derives an arbitrary week count from
// a real calendar date, not just these three. computeCheckpointWeeks in
// lib/training-programs.ts already handles any totalWeeks generically.
const MIN_WEEKS = 1;
const MAX_WEEKS = 26;

// Turns an AI-authored conditioning protocol into the one PrescribedExercise
// that represents a whole day — exerciseId stays null (no library exercise
// to link, same convention as a test-checkpoint protocol) and targetReps
// carries a short human summary for the existing preview-card rendering
// (ProgramDayCard already falls back to printing targetReps alone when
// targetSets is null). The mobile app seeds conditioningProtocol into a Run
// log entry instead of a normal exercise row — see log-workout.tsx.
function buildConditioningProtocolExercise(protocol: ProgrammeConditioningProtocol): PrescribedExercise {
  const distanceLabel = protocol.distanceMeters
    ? protocol.distanceMeters >= 1000
      ? `${(protocol.distanceMeters / 1000).toFixed(protocol.distanceMeters % 1000 === 0 ? 0 : 1)}km`
      : `${protocol.distanceMeters}m`
    : null;
  const summary =
    protocol.structure === "intervals" && protocol.reps
      ? [`${protocol.reps} ×`, distanceLabel].filter(Boolean).join(" ")
      : (distanceLabel ?? "Continuous effort");

  return {
    id: randomUUID(),
    exerciseId: null,
    name: protocol.name,
    muscleTags: [],
    targetSets: null,
    targetReps: summary,
    targetWeight: null,
    setType: null,
    sets: null,
    supersetGroup: null,
    notes: protocol.description,
    conditioningProtocol: {
      structure: protocol.structure,
      reps: protocol.reps,
      distanceMeters: protocol.distanceMeters,
      description: protocol.description,
    },
  };
}

// POST /api/mobile/programs/generate
// The "preview" half of the AI programme builder — everything here is
// resolved (AI skeleton, real exercises, initial targets) but NOTHING is
// saved. The member reviews the result and, if they want it, a separate
// call to /api/mobile/programs/save persists exactly what was previewed
// (no second AI call), the same scan-then-review split already used by
// tracker-import.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, configured: false, message: "Not signed in." }, { status: 401 });
  }

  if (!hasAccess(resolveMemberTierForUser(user.id), "workoutGenerate")) {
    return NextResponse.json(
      { success: false, configured: true, message: "Programme generation needs App Subscription or above." },
      { status: 403 }
    );
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { success: false, configured: false, message: "Programme generation isn't available right now." },
      { status: 503 }
    );
  }

  const rate = checkRateLimit(`ai-programme-generate:${user.id}`, GENERATE_RATE_LIMIT, GENERATE_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        success: false,
        configured: true,
        message: `You're generating quickly — try again in about ${rate.retryAfterSecs > 60 ? `${Math.ceil(rate.retryAfterSecs / 60)} min` : `${rate.retryAfterSecs}s`}.`,
      },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSecs) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, configured: true, message: "Invalid JSON body." }, { status: 400 });
  }

  const { goal, weeks, daysPerWeek, sessionMinutes, equipmentSlugs, gymProfileId, notes, splitPreference } = (body ?? {}) as Record<
    string,
    unknown
  >;

  const cleanGoal = typeof goal === "string" ? goal.trim().slice(0, 200) : "";
  const cleanWeeks =
    typeof weeks === "number" && Number.isInteger(weeks) && weeks >= MIN_WEEKS && weeks <= MAX_WEEKS ? weeks : null;
  const cleanDaysPerWeek =
    typeof daysPerWeek === "number" && Number.isInteger(daysPerWeek) && daysPerWeek >= 2 && daysPerWeek <= 6
      ? daysPerWeek
      : null;
  const cleanSessionMinutes =
    typeof sessionMinutes === "number" && Number.isFinite(sessionMinutes) && sessionMinutes > 0
      ? Math.round(sessionMinutes)
      : 45;
  const cleanEquipmentSlugs = Array.isArray(equipmentSlugs)
    ? equipmentSlugs.filter((s): s is string => typeof s === "string")
    : [];
  const cleanGymProfileId = typeof gymProfileId === "string" ? gymProfileId : null;
  const cleanNotes = typeof notes === "string" && notes.trim() ? notes.trim().slice(0, 500) : null;
  const cleanSplitPreference: "fullBody" | "upperLower" | null =
    splitPreference === "fullBody" || splitPreference === "upperLower" ? splitPreference : null;

  if (!cleanGoal || !cleanWeeks || !cleanDaysPerWeek) {
    return NextResponse.json(
      { success: false, configured: true, message: `goal, weeks (${MIN_WEEKS}-${MAX_WEEKS}), and daysPerWeek (2-6) are required.` },
      { status: 400 }
    );
  }

  // Real, approved exercise library — same source the single-workout
  // generator uses, not the small staff-tool catalogue in workout-helper.ts.
  const client = getExerciseLibraryClient();
  const { data, error } = await client.from("exercises").select("*").eq("approved", true).limit(500);
  if (error) {
    console.error("[programs/generate] exercise library fetch failed:", error);
    return NextResponse.json(
      { success: false, configured: true, message: "Could not load the exercise library." },
      { status: 500 }
    );
  }
  const exercises = (data ?? []).map(mapExerciseRow);
  const validBodyParts = [...new Set(exercises.map((e) => e.bodyPart).filter((v): v is string => !!v))];

  try {
    const splitMode = resolveSplitMode(cleanGoal, cleanSplitPreference);

    // Sports-performance members may already have their sport/running
    // logged in the pre-existing Weekly Training feature — surface it as
    // extra AI context (same "notes are real signal" mechanism already used
    // for member-typed notes) so rest-day placement/rep-scheme can account
    // for it, without a new onboarding question and without binding
    // skeleton days to real calendar weekdays (that stays a separate,
    // already-shipped post-save step — useSyncProgrammeToWeeklySchedule).
    let notesForAi = cleanNotes;
    if (cleanGoal === "Sports performance") {
      const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const schedule = findWeeklyTrainingScheduleByUserId(user.id);
      const relevant = (schedule?.sessions ?? []).filter((s) => s.activityType === "sport" || s.activityType === "cardio");
      if (relevant.length > 0) {
        const summary = relevant
          .map((s) => {
            const label = s.label.trim() || (s.activityType === "sport" ? "Sport" : "Cardio");
            const day = DAY_LABELS[s.dayOfWeek] ?? "";
            return s.intensity ? `${label} (${day}, ${s.intensity})` : `${label} (${day})`;
          })
          .join("; ");
        notesForAi = [cleanNotes, `Also trains outside the gym: ${summary}.`].filter((v): v is string => !!v).join(" ").slice(0, 900);
      }
    }

    const checkpointWeeks = computeCheckpointWeeks(cleanWeeks);
    const skeleton = await generateProgrammeSkeleton({
      goal: cleanGoal,
      daysPerWeek: cleanDaysPerWeek,
      sessionMinutes: cleanSessionMinutes,
      validBodyParts,
      notes: notesForAi,
      checkpointWeeks,
      splitMode,
      userId: user.id,
    });

    if (!skeleton || skeleton.days.length === 0) {
      return NextResponse.json(
        { success: false, configured: true, message: "Couldn't generate a programme right now. Please try again." },
        { status: 502 }
      );
    }

    const sessions = findWorkoutSessionsByUserId(user.id);
    const alreadyChosenIds = new Set<string>();

    // Upper/Lower alternates strictly across workout-type days only (rest
    // days don't consume a turn), starting with Upper.
    let workoutDayIndex = 0;

    const days = skeleton.days.map((day, dayIndex) => {
      if (day.type === "rest") {
        return { label: day.label, type: "rest" as const, exercises: [] };
      }

      // A running/conditioning protocol day replaces this day's content
      // entirely — bypasses both exercise pickers and, crucially,
      // resolveInitialProgrammeTargets (which would otherwise overwrite the
      // protocol's targetReps summary with a rep-scheme default). Doesn't
      // consume an Upper/Lower alternation turn either, since it isn't a
      // strength day.
      if (day.conditioningProtocol) {
        return {
          label: `Day ${dayIndex + 1} - ${day.conditioningProtocol.name}`,
          type: "workout" as const,
          exercises: [buildConditioningProtocolExercise(day.conditioningProtocol)],
        };
      }

      const repScheme: ProgrammeRepScheme = day.repScheme ?? "hypertrophy";

      if (splitMode === "freeform") {
        const picked = pickExercisesForDay({
          exercises,
          primaryBodyParts: day.primaryBodyParts,
          secondaryBodyParts: day.secondaryBodyParts,
          equipmentSlugs: cleanEquipmentSlugs,
          timeMinutes: cleanSessionMinutes,
          alreadyChosenIds,
        });
        const targeted = resolveInitialProgrammeTargets(picked, repScheme, sessions);
        return { label: day.label, type: "workout" as const, exercises: targeted };
      }

      // Structured (fullBody/upperLower) — the compound-first movement-
      // pattern picker owns exercise selection entirely; body parts never
      // enter into it, so the label reflects the actual structure rather
      // than whatever generic label the AI wrote.
      const half: "upper" | "lower" = workoutDayIndex % 2 === 0 ? "upper" : "lower";
      workoutDayIndex++;

      const picked = pickStructuredExercisesForDay({
        exercises,
        daySpec: splitMode === "upperLower" ? { mode: "upperLower", half } : { mode: "fullBody" },
        equipmentSlugs: cleanEquipmentSlugs,
        timeMinutes: cleanSessionMinutes,
        alreadyChosenIds,
      });
      const targeted = resolveInitialProgrammeTargets(picked, repScheme, sessions);
      const focus = splitMode === "upperLower" ? (half === "upper" ? "Upper Body" : "Lower Body") : "Full Body";
      const label = `Day ${dayIndex + 1} - ${focus}`;

      return { label, type: "workout" as const, exercises: targeted };
    });

    const validated = parseProgramDays(days);
    if (!validated.ok) {
      return NextResponse.json({ success: false, configured: true, message: validated.message }, { status: 502 });
    }

    const testCheckpoints = buildTestCheckpoints(skeleton.checkpoints);

    return NextResponse.json({
      success: true,
      configured: true,
      data: {
        name: `${skeleton.splitStyle} — ${cleanGoal}`.slice(0, 80),
        days: validated.days,
        totalWeeks: cleanWeeks,
        testCheckpoints,
        aiMeta: {
          goal: cleanGoal,
          splitStyle: skeleton.splitStyle,
          rationale: skeleton.rationale,
          daysPerWeek: cleanDaysPerWeek,
          sessionMinutes: cleanSessionMinutes,
          equipmentSlugs: cleanEquipmentSlugs,
          gymProfileId: cleanGymProfileId,
          notes: cleanNotes,
          generatedAt: new Date().toISOString(),
          splitMode,
        },
      },
    });
  } catch (err) {
    console.error(`[programs/generate] generation failed for user ${user.id}:`, err);
    return NextResponse.json(
      { success: false, configured: true, message: "Couldn't generate a programme right now. Please try again." },
      { status: 502 }
    );
  }
}
