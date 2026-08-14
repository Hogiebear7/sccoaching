import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteWorkoutSession, findUserById, findWorkoutSessionById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// A member can delete any of their own logged workout sessions — self-logged
// or class-synced. There's no "coach hasn't gotten around to it yet" state a
// delete could disrupt the way an in-progress edit might, so this doesn't
// carry the classId restrictions /api/workouts/edit and /api/workouts/update
// have between them; ownership is the only check.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to delete a workout." },
      { status: 401 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { id } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "A workout id is required." }, { status: 400 });
  }

  const session = findWorkoutSessionById(id.trim());

  if (!session || session.userId !== user.id) {
    return NextResponse.json({ success: false, message: "This workout doesn't exist." }, { status: 404 });
  }

  deleteWorkoutSession(session.id);

  return NextResponse.json({ success: true, message: "Workout deleted." }, { status: 200 });
}
