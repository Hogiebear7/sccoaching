import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, findWorkoutSessionById, updateWorkoutSession } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// POST /api/mobile/workouts/[id]/visibility — { isPrivate: boolean }
// A narrow, single-field toggle deliberately kept separate from
// /api/workouts/edit (self-logged) and /api/workouts/update (class-synced
// correction) — those two have their own distinct business rules about
// what's editable and when; this just flips one Community-feed flag on
// either kind of session, owner-only.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  const user = findUserById(session.userId);
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

  const { isPrivate } = (body ?? {}) as Record<string, unknown>;
  if (typeof isPrivate !== "boolean") {
    return NextResponse.json({ success: false, message: "isPrivate must be a boolean." }, { status: 400 });
  }

  // A workout staff removed from Community after a report stays removed: it can be kept private but not shared again.
  if (workout.communityRemovedAt && isPrivate === false) {
    return NextResponse.json(
      { success: false, message: "A coach removed this workout from Community after a report, so it can't be shared again." },
      { status: 403 }
    );
  }

  // The body was awaited after the workout was read: set only the flag, on the workout as it is NOW.
  updateWorkoutSession(workout.id, () => ({ isPrivate, updatedAt: new Date().toISOString() }));

  return NextResponse.json({ success: true, message: "Saved." });
}
