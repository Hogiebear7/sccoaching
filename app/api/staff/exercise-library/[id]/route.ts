import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { EXERCISE_MEDIA_BUCKET, getExerciseLibraryClient } from "@/lib/exercise-library/admin-client";
import { authorizeStaffRequest } from "@/lib/staff-auth";

const EDITABLE_TEXT_FIELDS = ["name", "bodyPart", "equipment", "targetMuscle", "category", "difficulty"] as const;
const COLUMN_BY_FIELD: Record<(typeof EDITABLE_TEXT_FIELDS)[number], string> = {
  name: "name",
  bodyPart: "body_part",
  equipment: "equipment",
  targetMuscle: "target_muscle",
  category: "category",
  difficulty: "difficulty",
};

// Rename/reclassify an exercise, or clear an optional field by sending "".
// Deliberately does not touch slug — existing links (member favorites,
// deep links) stay valid across a rename.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authorizeStaffRequest(request, "exercises.manage");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const update: Record<string, string | null> = {};

  for (const field of EDITABLE_TEXT_FIELDS) {
    if (!(field in input)) continue;
    const raw = input[field];
    if (typeof raw !== "string") {
      return NextResponse.json({ success: false, message: `${field} must be a string.` }, { status: 400 });
    }
    const trimmed = raw.trim();
    if (field === "name" && !trimmed) {
      return NextResponse.json({ success: false, message: "Name can't be empty." }, { status: 400 });
    }
    update[COLUMN_BY_FIELD[field]] = trimmed || null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: false, message: "Nothing to update." }, { status: 400 });
  }

  const client = getExerciseLibraryClient();
  const { data, error } = await client
    .from("exercises")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .single();

  if (error || !data) {
    console.error("[exercise-library] edit failed:", error);
    return NextResponse.json({ success: false, message: "Could not update this exercise." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// Deletes the exercise row (cascades to exercise_media and
// exercise_favorites at the DB level), then separately removes the now-
// orphaned gif files from storage — Supabase blocks deleting storage rows
// directly via SQL, so this has to go through the Storage API, and it has
// to happen after we've read the paths but can only run after we know the
// delete succeeded, so paths are captured first.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authorizeStaffRequest(request, "exercises.manage");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const client = getExerciseLibraryClient();

  const { data: media } = await client.from("exercise_media").select("storage_path").eq("exercise_id", id);

  const { error } = await client.from("exercises").delete().eq("id", id);
  if (error) {
    console.error("[exercise-library] delete failed:", error);
    return NextResponse.json({ success: false, message: "Could not delete this exercise." }, { status: 500 });
  }

  const paths = (media ?? []).map((m) => m.storage_path as string).filter(Boolean);
  if (paths.length > 0) {
    const { error: storageError } = await client.storage.from(EXERCISE_MEDIA_BUCKET).remove(paths);
    if (storageError) {
      // The exercise row is already gone — this is just leftover storage
      // cost, not a correctness problem. Log and move on rather than fail
      // a delete the staff member already sees as successful.
      console.error("[exercise-library] storage cleanup failed after delete:", storageError);
    }
  }

  return NextResponse.json({ success: true });
}
