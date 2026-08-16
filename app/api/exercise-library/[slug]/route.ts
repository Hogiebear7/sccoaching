import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getExerciseLibraryClient } from "@/lib/exercise-library/admin-client";
import { mapExerciseRow, mapMediaRow } from "@/lib/exercise-library/mappers";
import { findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  }

  const { slug } = await params;
  const client = getExerciseLibraryClient();

  const { data: row, error } = await client
    .from("exercises")
    .select("*")
    .eq("slug", slug)
    .eq("approved", true)
    .maybeSingle();

  if (error) {
    console.error("[exercise-library] detail fetch failed:", error);
    return NextResponse.json({ success: false, message: "Could not load this exercise." }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ success: false, message: "Exercise not found." }, { status: 404 });
  }

  const exercise = mapExerciseRow(row);

  const [{ data: mediaRows }, { data: favoriteRow }] = await Promise.all([
    client.from("exercise_media").select("*").eq("exercise_id", exercise.id).order("resolution", { ascending: true }),
    client.from("exercise_favorites").select("id").eq("user_id", user.id).eq("exercise_id", exercise.id).maybeSingle(),
  ]);

  // Best-effort: resolve related-exercise refs (stored by the vendor's
  // source id inside taxonomy) to a slug in OUR table, when that related
  // exercise has also been imported and approved — gracefully degrades to
  // a plain (unlinked) name otherwise, which is the common case while only
  // a sample pack is loaded.
  const relatedSourceIds = new Set<string>();
  const taxonomy = exercise.taxonomy ?? {};
  for (const key of ["similarExercises", "substitutions", "progressions", "regressions"] as const) {
    const refs = (taxonomy[key] as { id: string }[] | undefined) ?? [];
    for (const ref of refs) relatedSourceIds.add(ref.id);
  }

  let slugBySourceId = new Map<string, string>();
  if (relatedSourceIds.size > 0) {
    const { data: relatedRows } = await client
      .from("exercises")
      .select("source_id, slug")
      .eq("source", exercise.source)
      .eq("approved", true)
      .in("source_id", [...relatedSourceIds]);
    slugBySourceId = new Map((relatedRows ?? []).map((r) => [r.source_id as string, r.slug as string]));
  }

  function withSlugs(key: "similarExercises" | "substitutions" | "progressions" | "regressions") {
    const refs = (taxonomy[key] as { id: string; name: string }[] | undefined) ?? [];
    return refs.map((ref) => ({ ...ref, slug: slugBySourceId.get(ref.id) ?? null }));
  }

  return NextResponse.json({
    success: true,
    exercise,
    media: (mediaRows ?? []).map(mapMediaRow),
    favorited: !!favoriteRow,
    related: {
      similarExercises: withSlugs("similarExercises"),
      substitutions: withSlugs("substitutions"),
      progressions: withSlugs("progressions"),
      regressions: withSlugs("regressions"),
    },
  });
}
