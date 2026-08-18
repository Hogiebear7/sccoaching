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
import { activeWeeklySessions, mondayOfWeek } from "@/lib/weekly-training";

const MAX_SESSIONS = 21; // generous headroom over 1/day — a day can have AM+PM entries
const MAX_LABEL_LENGTH = 60;
const MAX_NOTES_LENGTH = 200;

const ACTIVITY_TYPES: TrainingActivityType[] = ["gym", "sport", "cardio", "rest", "other"];
const TIME_OF_DAY: TrainingTimeOfDay[] = ["morning", "afternoon", "evening"];
const INTENSITIES: TrainingIntensity[] = ["light", "moderate", "heavy"];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Normalizes whatever the client sends into a valid session list — same
// discipline as pinned-exercises/drink-settings: the stored record is
// always valid regardless of client input, nothing here trusts the wire.
// weekOf is never taken from the client — a genuinely new one-off is always
// "this week", computed server-side. For an existing one-off being resent
// as part of a full-list save (e.g. the member edited an unrelated
// recurring session), its original weekOf is preserved via
// existingWeekOfById — otherwise every save would silently "renew" old
// one-offs back to the current week and they'd never actually clear.
function normalizeSessions(
  input: unknown,
  currentWeekMonday: string,
  existingWeekOfById: Map<string, string | null>
): WeeklyTrainingSession[] {
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

    const id = typeof entry.id === "string" && entry.id ? entry.id : crypto.randomUUID();
    // Missing/invalid `recurring` defaults to true — an older client that
    // predates this field sends no `recurring` at all, and every session it
    // sends should keep behaving exactly like it always did (always applies).
    const recurring = typeof entry.recurring === "boolean" ? entry.recurring : true;
    const weekOf = recurring ? null : (existingWeekOfById.get(id) ?? currentWeekMonday);

    result.push({
      id,
      dayOfWeek: dayOfWeek as WeeklyTrainingSession["dayOfWeek"],
      label,
      activityType,
      timeOfDay,
      intensity,
      notes,
      recurring,
      weekOf,
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
  const sessions = activeWeeklySessions(schedule?.sessions ?? [], todayISO());

  return NextResponse.json({
    success: true,
    data: { sessions, updatedAt: schedule?.updatedAt ?? null },
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

  const existing = findWeeklyTrainingScheduleByUserId(session.userId);
  const existingWeekOfById = new Map((existing?.sessions ?? []).map((s) => [s.id, s.weekOf]));
  const currentWeekMonday = mondayOfWeek(todayISO());
  const sessions = normalizeSessions((body as { sessions?: unknown }).sessions, currentWeekMonday, existingWeekOfById);
  const now = new Date().toISOString();

  saveWeeklyTrainingSchedule({ userId: session.userId, sessions, updatedAt: now });

  return NextResponse.json({ success: true, data: { sessions, updatedAt: now } });
}
