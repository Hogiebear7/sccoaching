import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findBodyWeightLogsByUserId,
  findProfileByUserId,
  findUserById,
  saveBodyWeightLog,
  saveProfile,
  type BodyWeightLogRecord,
} from "@/lib/db";
import { resolveCurrentWeightKg } from "@/lib/body-weight";
import { verifySession } from "@/lib/session";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!userId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to log weight." },
      { status: 401 }
    );
  }

  const user = findUserById(userId);

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to log weight." },
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

  const { date, weightKg } = (body ?? {}) as Record<string, unknown>;

  if (typeof date !== "string" || !ISO_DATE_RE.test(date)) {
    return NextResponse.json(
      { success: false, message: "Date must be a valid YYYY-MM-DD string." },
      { status: 400 }
    );
  }

  if (typeof weightKg !== "number" || !Number.isFinite(weightKg) || weightKg <= 0) {
    return NextResponse.json(
      { success: false, message: "Weight must be a positive number." },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  const log: BodyWeightLogRecord = {
    id: randomUUID(),
    userId: user.id,
    date,
    weightKg,
    createdAt: now,
  };

  saveBodyWeightLog(log);

  // Keep the profile's current weight in sync with the latest log entry.
  // Resolving over all logs means a backdated entry never overwrites a
  // newer weight.
  const profile = findProfileByUserId(user.id);
  if (profile) {
    const synced = resolveCurrentWeightKg(profile.currentWeightKg, findBodyWeightLogsByUserId(user.id));
    if (synced !== profile.currentWeightKg) {
      saveProfile({ ...profile, currentWeightKg: synced, updatedAt: now });
    }
  }

  return NextResponse.json({ success: true, message: "Weight logged." }, { status: 201 });
}
