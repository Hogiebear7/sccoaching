import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getExerciseLibraryClient } from "@/lib/exercise-library/admin-client";
import { mapExerciseRow } from "@/lib/exercise-library/mappers";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// Admin inspect view — every exercise regardless of approval state, unlike
// the member-facing list which only ever returns approved rows.
export async function GET(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "exercises.manage");
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const approvedParam = searchParams.get("approved");

  const client = getExerciseLibraryClient();
  let query = client.from("exercises").select("*").order("created_at", { ascending: false }).limit(500);

  if (q) query = query.ilike("name", `%${q}%`);
  if (approvedParam === "true") query = query.eq("approved", true);
  if (approvedParam === "false") query = query.eq("approved", false);

  const { data, error } = await query;
  if (error) {
    console.error("[exercise-library] admin list failed:", error);
    return NextResponse.json({ success: false, message: "Could not load exercises." }, { status: 500 });
  }

  return NextResponse.json({ success: true, exercises: (data ?? []).map(mapExerciseRow) });
}
