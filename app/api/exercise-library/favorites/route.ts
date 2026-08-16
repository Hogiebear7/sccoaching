import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getExerciseLibraryClient } from "@/lib/exercise-library/admin-client";
import { findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

function requireUser(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  return userId ? findUserById(userId) : undefined;
}

export async function GET(request: NextRequest) {
  const user = requireUser(request);
  if (!user) {
    return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  }

  const client = getExerciseLibraryClient();
  const { data, error } = await client.from("exercise_favorites").select("exercise_id").eq("user_id", user.id);

  if (error) {
    console.error("[exercise-library] favorites fetch failed:", error);
    return NextResponse.json({ success: false, message: "Could not load favorites." }, { status: 500 });
  }

  return NextResponse.json({ success: true, exerciseIds: (data ?? []).map((r) => r.exercise_id as string) });
}

export async function POST(request: NextRequest) {
  const user = requireUser(request);
  if (!user) {
    return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { exerciseId, favorited } = (body ?? {}) as Record<string, unknown>;
  if (typeof exerciseId !== "string" || !exerciseId.trim()) {
    return NextResponse.json({ success: false, message: "exerciseId is required." }, { status: 400 });
  }
  if (typeof favorited !== "boolean") {
    return NextResponse.json({ success: false, message: "favorited must be a boolean." }, { status: 400 });
  }

  const client = getExerciseLibraryClient();

  if (favorited) {
    const { error } = await client
      .from("exercise_favorites")
      .upsert({ user_id: user.id, exercise_id: exerciseId }, { onConflict: "user_id,exercise_id" });
    if (error) {
      console.error("[exercise-library] favorite add failed:", error);
      return NextResponse.json({ success: false, message: "Could not save favorite." }, { status: 500 });
    }
  } else {
    const { error } = await client
      .from("exercise_favorites")
      .delete()
      .eq("user_id", user.id)
      .eq("exercise_id", exerciseId);
    if (error) {
      console.error("[exercise-library] favorite remove failed:", error);
      return NextResponse.json({ success: false, message: "Could not remove favorite." }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
