import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { EXERCISE_MEDIA_BUCKET, getExerciseLibraryClient } from "@/lib/exercise-library/admin-client";
import { checkOwnVideo, OWN_VIDEO_KIND, OWN_VIDEO_RESOLUTION, ownVideoStoragePath } from "@/lib/exercise-library/own-video";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// Upload (or replace) your own demonstration clip for an exercise, or remove it. Staff with the exercise library permission only.

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authorizeStaffRequest(request, "exercises.manage");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ success: false, message: "Send the clip as a file upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, message: "Choose a video file." }, { status: 400 });
  }

  const check = checkOwnVideo(file.type, file.size);
  if (!check.ok) return NextResponse.json({ success: false, message: check.message }, { status: 400 });

  const client = getExerciseLibraryClient();
  const { data: exercise, error: findError } = await client.from("exercises").select("id").eq("id", id).maybeSingle();
  if (findError || !exercise) {
    return NextResponse.json({ success: false, message: "This exercise no longer exists." }, { status: 404 });
  }

  // One own clip per exercise: a new upload replaces the old file even if its type (and so its extension) differs.
  const { data: existing } = await client
    .from("exercise_media")
    .select("storage_path")
    .eq("exercise_id", id)
    .eq("kind", OWN_VIDEO_KIND)
    .eq("resolution", OWN_VIDEO_RESOLUTION)
    .maybeSingle();

  const storagePath = ownVideoStoragePath(id, check.extension);
  const { error: uploadError } = await client.storage
    .from(EXERCISE_MEDIA_BUCKET)
    .upload(storagePath, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true });
  if (uploadError) {
    console.error("[exercise-library] own video upload failed:", uploadError);
    return NextResponse.json({ success: false, message: "Could not store the clip. Please try again." }, { status: 500 });
  }

  const { error: rowError } = await client.from("exercise_media").upsert(
    {
      exercise_id: id,
      kind: OWN_VIDEO_KIND,
      resolution: OWN_VIDEO_RESOLUTION,
      storage_path: storagePath,
      url: "",
      bytes: file.size,
    },
    { onConflict: "exercise_id,kind,resolution" }
  );
  if (rowError) {
    console.error("[exercise-library] own video row failed:", rowError);
    return NextResponse.json({ success: false, message: "The clip was stored but could not be saved. Please try again." }, { status: 500 });
  }

  if (existing?.storage_path && existing.storage_path !== storagePath) {
    await client.storage.from(EXERCISE_MEDIA_BUCKET).remove([existing.storage_path as string]);
  }

  return NextResponse.json({ success: true, message: "Your clip is saved. Members will see it instead of the library picture." });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authorizeStaffRequest(request, "exercises.manage");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const client = getExerciseLibraryClient();

  const { data: existing } = await client
    .from("exercise_media")
    .select("storage_path")
    .eq("exercise_id", id)
    .eq("kind", OWN_VIDEO_KIND)
    .eq("resolution", OWN_VIDEO_RESOLUTION)
    .maybeSingle();
  if (!existing) return NextResponse.json({ success: false, message: "There is no clip to remove." }, { status: 404 });

  await client.from("exercise_media").delete().eq("exercise_id", id).eq("kind", OWN_VIDEO_KIND).eq("resolution", OWN_VIDEO_RESOLUTION);
  await client.storage.from(EXERCISE_MEDIA_BUCKET).remove([existing.storage_path as string]);
  return NextResponse.json({ success: true, message: "Clip removed. Members see the library picture again." });
}
