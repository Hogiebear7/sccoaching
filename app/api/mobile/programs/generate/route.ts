import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { generateProgrammeSkeleton, isAiConfigured } from "@/lib/ai";
import { findUserById, findWorkoutSessionsByUserId } from "@/lib/db";
import { getExerciseLibraryClient } from "@/lib/exercise-library/admin-client";
import { mapExerciseRow } from "@/lib/exercise-library/mappers";
import { hasAccess } from "@/lib/member-access";
import { resolveMemberTierForUser } from "@/lib/membership-entitlement";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { pickExercisesForDay } from "@/lib/programme-exercise-picker";
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

const VALID_WEEKS = new Set([4, 8, 12]);

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

  const { goal, weeks, daysPerWeek, sessionMinutes, equipmentSlugs, gymProfileId, notes } = (body ?? {}) as Record<
    string,
    unknown
  >;

  const cleanGoal = typeof goal === "string" ? goal.trim().slice(0, 200) : "";
  const cleanWeeks = typeof weeks === "number" && VALID_WEEKS.has(weeks) ? weeks : null;
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

  if (!cleanGoal || !cleanWeeks || !cleanDaysPerWeek) {
    return NextResponse.json(
      { success: false, configured: true, message: "goal, weeks (4/8/12), and daysPerWeek (2-6) are required." },
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
    const checkpointWeeks = computeCheckpointWeeks(cleanWeeks);
    const skeleton = await generateProgrammeSkeleton({
      goal: cleanGoal,
      daysPerWeek: cleanDaysPerWeek,
      sessionMinutes: cleanSessionMinutes,
      validBodyParts,
      notes: cleanNotes,
      checkpointWeeks,
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

    const days = skeleton.days.map((day) => {
      if (day.type === "rest") {
        return { label: day.label, type: "rest" as const, exercises: [] };
      }

      const picked = pickExercisesForDay({
        exercises,
        primaryBodyParts: day.primaryBodyParts,
        secondaryBodyParts: day.secondaryBodyParts,
        equipmentSlugs: cleanEquipmentSlugs,
        timeMinutes: cleanSessionMinutes,
        alreadyChosenIds,
      });

      const repScheme: ProgrammeRepScheme = day.repScheme ?? "hypertrophy";
      const targeted = resolveInitialProgrammeTargets(picked, repScheme, sessions);

      return { label: day.label, type: "workout" as const, exercises: targeted };
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
          daysPerWeek: cleanDaysPerWeek,
          sessionMinutes: cleanSessionMinutes,
          equipmentSlugs: cleanEquipmentSlugs,
          gymProfileId: cleanGymProfileId,
          notes: cleanNotes,
          generatedAt: new Date().toISOString(),
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
