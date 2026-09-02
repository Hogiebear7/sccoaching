import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findRecoveryLogsByUserId,
  findUserById,
  findWeeklyTrainingScheduleByUserId,
  findWorkoutSessionsByUserId,
} from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { computeRollingTrainingLoad } from "@/lib/recovery";
import { plannedExertionForDate } from "@/lib/weekly-training";
import { classifyLoad, decideTier, LOAD_BAND_LABEL } from "@/lib/workout-helper";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Today's Workout Helper session tier (full/standard/reduced) plus why —
// the same decision the web dashboard's Workout Helper and the AI Coach's
// own context already use (lib/workout-helper.ts's decideTier), now also
// available to the mobile Workout Generator so it can scale what it
// generates the same way, instead of always producing a flat 3-set/8-12-rep
// prescription regardless of readiness, training load, or what's already
// booked/planned for today.
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  }

  const today = todayISO();
  const recoveryLogs = findRecoveryLogsByUserId(user.id);
  const sessions = findWorkoutSessionsByUserId(user.id);
  const schedule = findWeeklyTrainingScheduleByUserId(user.id);

  const todayLog = recoveryLogs.find((log) => log.date === today);
  const readinessScore = todayLog?.readinessScore ?? null;
  const rolling = computeRollingTrainingLoad(recoveryLogs, sessions);
  const loadBand = classifyLoad(rolling.sevenDaySum, rolling.daysWithLoad);
  const plannedTodayExertion = plannedExertionForDate(schedule, today);

  const { tier, rationale } = decideTier({
    readinessScore,
    sevenDayLoad: rolling.sevenDaySum,
    daysWithLoad: rolling.daysWithLoad,
    plannedTodayExertion,
  });

  const tierLabel = tier === "full" ? "Full session" : tier === "standard" ? "Standard session" : "Reduced session";

  return NextResponse.json({
    success: true,
    data: {
      tier,
      tierLabel,
      rationale,
      loadBand,
      loadBandLabel: LOAD_BAND_LABEL[loadBand],
      readinessScore,
    },
  });
}
