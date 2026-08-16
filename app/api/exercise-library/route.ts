import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getExerciseLibraryClient } from "@/lib/exercise-library/admin-client";
import { mapExerciseRow } from "@/lib/exercise-library/mappers";
import { findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// Member-facing library browse — approved exercises only, ever. Bearer/
// cookie hybrid auth so this works from both web and mobile without change.
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const bodyPart = searchParams.get("bodyPart")?.trim();
  const equipment = searchParams.get("equipment")?.trim();
  const category = searchParams.get("category")?.trim();

  const client = getExerciseLibraryClient();
  let query = client.from("exercises").select("*").eq("approved", true).order("name", { ascending: true }).limit(500);

  if (q) query = query.or(`name.ilike.%${q}%,aliases.cs.{${q}}`);
  if (bodyPart) query = query.eq("body_part", bodyPart);
  if (equipment) query = query.eq("equipment", equipment);
  if (category) query = query.eq("category", category);

  const { data, error } = await query;
  if (error) {
    console.error("[exercise-library] member list failed:", error);
    return NextResponse.json({ success: false, message: "Could not load the exercise library." }, { status: 500 });
  }

  const exercises = (data ?? []).map(mapExerciseRow);

  // Distinct filter values, derived from the currently-approved set — the
  // filter chips only ever offer options that actually return results.
  const filters = {
    bodyParts: [...new Set(exercises.map((e) => e.bodyPart).filter((v): v is string => !!v))].sort(),
    equipment: [...new Set(exercises.map((e) => e.equipment).filter((v): v is string => !!v))].sort(),
    categories: [...new Set(exercises.map((e) => e.category).filter((v): v is string => !!v))].sort(),
  };

  return NextResponse.json({ success: true, exercises, filters });
}
