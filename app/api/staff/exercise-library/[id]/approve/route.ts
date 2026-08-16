import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getExerciseLibraryClient } from "@/lib/exercise-library/admin-client";
import { authorizeStaffRequest } from "@/lib/staff-auth";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authorizeStaffRequest(request, "exercises.manage");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { approved } = (body ?? {}) as Record<string, unknown>;
  if (typeof approved !== "boolean") {
    return NextResponse.json({ success: false, message: "approved must be a boolean." }, { status: 400 });
  }

  const client = getExerciseLibraryClient();
  const { error } = await client
    .from("exercises")
    .update({ approved, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("[exercise-library] approve toggle failed:", error);
    return NextResponse.json({ success: false, message: "Could not update this exercise." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
