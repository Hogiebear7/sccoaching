import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteExercise, findExerciseById, findUserById } from "@/lib/db";
import { verifySession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const sessionUserId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage exercises." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser || staffUser.role !== "staff") {
    return NextResponse.json(
      { success: false, message: "Only staff can manage exercises." },
      { status: 403 }
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

  const { id } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json(
      { success: false, message: "Exercise ID is required." },
      { status: 400 }
    );
  }

  const exercise = findExerciseById(id);

  if (!exercise) {
    return NextResponse.json(
      { success: false, message: "Exercise not found." },
      { status: 404 }
    );
  }

  deleteExercise(id);

  return NextResponse.json(
    { success: true, message: "Exercise deleted." },
    { status: 200 }
  );
}
