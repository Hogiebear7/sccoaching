import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findWeeklyTrainingScheduleByUserId,
  saveWeeklyTrainingSchedule,
} from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import type {
  TrainingActivityType,
  TrainingIntensity,
  TrainingTimeOfDay,
  WeeklyTrainingSession,
} from "@/lib/profile-schema";

const MAX_SESSIONS = 21; // generous headroom over 1/day — a day can have AM+PM entries
const MAX_LABEL_LENGTH = 60;
const MAX_NOTES_LENGTH = 200;

const ACTIVITY_TYPES: TrainingActivityType[] = ["gym", "sport", "cardio", "rest", "other"];
const TIME_OF_DAY: TrainingTimeOfDay[] = ["morning", "afternoon", "evening"];
const INTENSITIES: TrainingIntensity[] = ["light", "moderate", "heavy"];

// Normalizes whatever the client sends into a valid session list — same
// discipline as pinned-exercises/drink-settings: the stored record is
// always valid regardless of client input, nothing here trusts the wire.
function normalizeSessions(input: unknown): WeeklyTrainingSession[] {
  if (!Array.isArray(input)) return [];

  const result: WeeklyTrainingSession[] = [];

  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;

    const dayOfWeek = Number(entry.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) continue;

    const label = typeof entry.label === "string" ? entry.label.trim().slice(0, MAX_LABEL_LENGTH) : "";
    if (!label) continue;

    const activityType: TrainingActivityType = ACTIVITY_TYPES.includes(entry.activityType as TrainingActivityType)
      ? (entry.activityType as TrainingActivityType)
      : "other";

    const timeOfDay: TrainingTimeOfDay | null = TIME_OF_DAY.includes(entry.timeOfDay as TrainingTimeOfDay)
      ? (entry.timeOfDay as TrainingTimeOfDay)
      : null;

    const intensity: TrainingIntensity | null = INTENSITIES.includes(entry.intensity as TrainingIntensity)
      ? (entry.intensity as TrainingIntensity)
      : null;

    const notes =
      typeof entry.notes === "string" && entry.notes.trim()
        ? entry.notes.trim().slice(0, MAX_NOTES_LENGTH)
        : null;

    result.push({
      id: typeof entry.id === "string" && entry.id ? entry.id : crypto.randomUUID(),
      dayOfWeek: dayOfWeek as WeeklyTrainingSession["dayOfWeek"],
      label,
      activityType,
      timeOfDay,
      intensity,
      notes,
    });

    if (result.length >= MAX_SESSIONS) break;
  }

  return result;
}

export async function GET(request: NextRequest) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const schedule = findWeeklyTrainingScheduleByUserId(session.userId);

  return NextResponse.json({
    success: true,
    data: { sessions: schedule?.sessions ?? [], updatedAt: schedule?.updatedAt ?? null },
  });
}

export async function POST(request: NextRequest) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ success: false, message: "Sessions are required." }, { status: 400 });
  }

  const sessions = normalizeSessions((body as { sessions?: unknown }).sessions);
  const now = new Date().toISOString();

  saveWeeklyTrainingSchedule({ userId: session.userId, sessions, updatedAt: now });

  return NextResponse.json({ success: true, data: { sessions, updatedAt: now } });
}
