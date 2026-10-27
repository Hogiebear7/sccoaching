import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, findWorkoutSessionById, saveWorkoutSession } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// POST /api/mobile/workouts/[id]/wearable — { calories?, avgHr?, maxHr? }
// What the member's watch reported for one of their own sessions. Each
// field is optional; null clears it. Calories feed that day's calorie
// target (half counts, see lib/workout-calories.ts); heart rate only feeds
// the workout review.
function readNumber(value: unknown, min: number, max: number): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return NaN;
  return Math.round(value);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = verifyRequestSession(request);
  const user = session ? findUserById(session.userId) : undefined;
  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const workout = findWorkoutSessionById(id);
  if (!workout || workout.userId !== user.id) {
    return NextResponse.json({ success: false, message: "Workout not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const raw = (body ?? {}) as Record<string, unknown>;
  const calories = readNumber(raw.calories, 1, 5000);
  const avgHr = readNumber(raw.avgHr, 30, 240);
  const maxHr = readNumber(raw.maxHr, 30, 240);
  if ([calories, avgHr, maxHr].some((v) => typeof v === "number" && Number.isNaN(v))) {
    return NextResponse.json(
      { success: false, message: "Calories must be 1–5,000 and heart rates 30–240." },
      { status: 400 }
    );
  }

  saveWorkoutSession({
    ...workout,
    ...(calories !== undefined ? { wearableCalories: calories } : {}),
    ...(avgHr !== undefined ? { avgHr } : {}),
    ...(maxHr !== undefined ? { maxHr } : {}),
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ success: true, message: "Saved." });
}
