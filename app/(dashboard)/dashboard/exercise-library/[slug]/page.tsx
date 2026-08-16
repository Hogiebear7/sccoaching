import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { findUserById } from "@/lib/db";
import { getExerciseLibraryClient } from "@/lib/exercise-library/admin-client";
import { mapExerciseRow, mapMediaRow } from "@/lib/exercise-library/mappers";
import { verifySession } from "@/lib/session";
import { ExerciseDetailView } from "./ExerciseDetailView";

export default async function ExerciseDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return (
      <div className="space-y-8">
        <div className="surface-card p-5">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load your account. Try logging out and back in.
          </p>
        </div>
      </div>
    );
  }

  const client = getExerciseLibraryClient();
  const { data: row } = await client.from("exercises").select("*").eq("slug", slug).eq("approved", true).maybeSingle();

  if (!row) notFound();

  const exercise = mapExerciseRow(row);

  const [{ data: mediaRows }, { data: favoriteRow }] = await Promise.all([
    client.from("exercise_media").select("*").eq("exercise_id", exercise.id).order("resolution", { ascending: true }),
    client.from("exercise_favorites").select("id").eq("user_id", user.id).eq("exercise_id", exercise.id).maybeSingle(),
  ]);

  const taxonomy = exercise.taxonomy ?? {};
  const relatedSourceIds = new Set<string>();
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

  return (
    <ExerciseDetailView
      exercise={exercise}
      media={(mediaRows ?? []).map(mapMediaRow)}
      favorited={!!favoriteRow}
      related={{
        similarExercises: withSlugs("similarExercises"),
        substitutions: withSlugs("substitutions"),
        progressions: withSlugs("progressions"),
        regressions: withSlugs("regressions"),
      }}
    />
  );
}
