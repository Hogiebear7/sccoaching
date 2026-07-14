import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findRecoveryLogByUserIdAndDate,
  findUserById,
  saveRecoveryLog,
  type RecoveryLogRecord,
} from "@/lib/db";
import { computeReadinessScore } from "@/lib/recovery";
import { verifySession } from "@/lib/session";

function parseRequiredRange(
  value: unknown,
  min: number,
  max: number
): { ok: true; value: number } | { ok: false } {
  if (typeof value !== "string" || !value.trim()) return { ok: false };

  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) return { ok: false };

  return { ok: true, value: parsed };
}

function parseOptionalNonNegativeInt(
  value: unknown
): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  if (value.trim() === "") return { ok: true, value: null };

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return { ok: false };

  return { ok: true, value: parsed };
}

function parseOptionalRange(
  value: unknown,
  min: number,
  max: number
): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  if (value.trim() === "") return { ok: true, value: null };

  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) return { ok: false };

  return { ok: true, value: parsed };
}

export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!userId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to log recovery." },
      { status: 401 }
    );
  }

  const user = findUserById(userId);

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to log recovery." },
      { status: 401 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const {
    date,
    sleepHours,
    sleepQuality,
    soreness,
    fatigue,
    trainingDurationMins,
    rpe,
    goal,
    notes,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof date !== "string" || !date.trim()) {
    return NextResponse.json(
      { success: false, message: "Date is required." },
      { status: 400 }
    );
  }

  const sleepHoursResult = parseRequiredRange(sleepHours, 0, 24);
  if (!sleepHoursResult.ok) {
    return NextResponse.json(
      { success: false, message: "Sleep hours must be a number between 0 and 24." },
      { status: 400 }
    );
  }

  const sleepQualityResult = parseRequiredRange(sleepQuality, 1, 10);
  if (!sleepQualityResult.ok) {
    return NextResponse.json(
      { success: false, message: "Sleep quality must be between 1 and 5." },
      { status: 400 }
    );
  }

  const sorenessResult = parseRequiredRange(soreness, 1, 10);
  if (!sorenessResult.ok) {
    return NextResponse.json(
      { success: false, message: "Soreness must be between 1 and 5." },
      { status: 400 }
    );
  }

  const fatigueResult = parseRequiredRange(fatigue, 1, 5);
  if (!fatigueResult.ok) {
    return NextResponse.json(
      { success: false, message: "Fatigue must be between 1 and 5." },
      { status: 400 }
    );
  }

  const durationResult = parseOptionalNonNegativeInt(trainingDurationMins);
  if (!durationResult.ok) {
    return NextResponse.json(
      { success: false, message: "Training duration must be a whole number." },
      { status: 400 }
    );
  }

  const rpeResult = parseOptionalRange(rpe, 1, 10);
  if (!rpeResult.ok) {
    return NextResponse.json(
      { success: false, message: "RPE must be between 1 and 10." },
      { status: 400 }
    );
  }

  const trimmedDate = date.trim();
  const existingLog = findRecoveryLogByUserIdAndDate(user.id, trimmedDate);
  const now = new Date().toISOString();

  const readinessScore = computeReadinessScore({
    sleepHours: sleepHoursResult.value,
    sleepQuality: sleepQualityResult.value,
    soreness: sorenessResult.value,
    fatigue: fatigueResult.value,
  });

  const log: RecoveryLogRecord = {
    id: existingLog?.id ?? randomUUID(),
    userId: user.id,
    date: trimmedDate,
    sleepHours: sleepHoursResult.value,
    sleepQuality: sleepQualityResult.value,
    soreness: sorenessResult.value,
    fatigue: fatigueResult.value,
    scale10: true,
    trainingDurationMins: durationResult.value,
    rpe: rpeResult.value,
    goal: typeof goal === "string" && goal.trim() ? goal.trim() : null,
    notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    readinessScore,
    createdAt: existingLog?.createdAt ?? now,
    updatedAt: now,
  };

  saveRecoveryLog(log);

  return NextResponse.json(
    { success: true, message: existingLog ? "Recovery log updated." : "Recovery log saved." },
    { status: existingLog ? 200 : 201 }
  );
}
