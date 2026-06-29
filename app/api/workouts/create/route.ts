import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findUserById,
  saveWorkoutSession,
  type WorkoutSessionRecord,
} from "@/lib/db";
import { verifySession } from "@/lib/session";

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

export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!userId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to log a workout." },
      { status: 401 }
    );
  }

  const user = findUserById(userId);

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to log a workout." },
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

  const { title, date, durationMins, notes } = (body ?? {}) as Record<string, unknown>;

  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json(
      { success: false, message: "Title is required." },
      { status: 400 }
    );
  }

  if (typeof date !== "string" || !date.trim()) {
    return NextResponse.json(
      { success: false, message: "Date is required." },
      { status: 400 }
    );
  }

  const durationResult = parseOptionalNonNegativeInt(durationMins);

  if (!durationResult.ok) {
    return NextResponse.json(
      { success: false, message: "Duration must be a whole number." },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  const session: WorkoutSessionRecord = {
    id: randomUUID(),
    userId: user.id,
    date: date.trim(),
    title: title.trim(),
    durationMins: durationResult.value,
    notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    createdAt: now,
    updatedAt: now,
  };

  saveWorkoutSession(session);

  return NextResponse.json(
    { success: true, message: "Workout logged." },
    { status: 201 }
  );
}
