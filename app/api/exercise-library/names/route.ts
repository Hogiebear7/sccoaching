import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getExerciseLibraryClient } from "@/lib/exercise-library/admin-client";
import { findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// Lightweight name+slug index for approved exercises — used to link "you're
// logging Barbell Bench Press" to its library detail page (GIF, cues, etc.)
// without pulling every field the full list/detail routes return. Cheap
// enough to fetch once per workout-log session even at full-dataset scale.
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  }

  const client = getExerciseLibraryClient();
  const { data, error } = await client.from("exercises").select("name, slug").eq("approved", true).limit(5000);

  if (error) {
    console.error("[exercise-library] names index failed:", error);
    return NextResponse.json({ success: false, message: "Could not load the exercise index." }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    items: (data ?? []).map((r) => ({ name: r.name as string, slug: r.slug as string })),
  });
}
