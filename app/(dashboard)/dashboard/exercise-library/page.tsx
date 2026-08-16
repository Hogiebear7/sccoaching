import { cookies } from "next/headers";

import { findUserById } from "@/lib/db";
import { getExerciseLibraryClient } from "@/lib/exercise-library/admin-client";
import { mapExerciseRow } from "@/lib/exercise-library/mappers";
import { verifySession } from "@/lib/session";
import { ExerciseLibraryView } from "./ExerciseLibraryView";

export default async function DashboardExerciseLibraryPage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return (
      <div className="space-y-8">
        <h1 className="text-display text-[28px]">Exercise Library</h1>
        <div className="surface-card p-5">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load your account. Try logging out and back in.
          </p>
        </div>
      </div>
    );
  }

  const client = getExerciseLibraryClient();
  const [{ data: exerciseRows }, { data: mediaRows }, { data: favoriteRows }] = await Promise.all([
    client.from("exercises").select("*").eq("approved", true).order("name", { ascending: true }).limit(1000),
    // Thumbnail resolution only — the detail page fetches its own larger
    // variant on demand rather than shipping every resolution to the list.
    client.from("exercise_media").select("exercise_id, url, resolution").eq("resolution", "180"),
    client.from("exercise_favorites").select("exercise_id").eq("user_id", user.id),
  ]);

  const exercises = (exerciseRows ?? []).map(mapExerciseRow);
  const thumbByExerciseId = new Map((mediaRows ?? []).map((r) => [r.exercise_id as string, r.url as string]));
  const favoriteIds = new Set((favoriteRows ?? []).map((r) => r.exercise_id as string));

  const items = exercises.map((e) => ({
    ...e,
    thumbnailUrl: thumbByExerciseId.get(e.id) ?? null,
    favorited: favoriteIds.has(e.id),
  }));

  const filters = {
    bodyParts: [...new Set(items.map((e) => e.bodyPart).filter((v): v is string => !!v))].sort(),
    equipment: [...new Set(items.map((e) => e.equipment).filter((v): v is string => !!v))].sort(),
    categories: [...new Set(items.map((e) => e.category).filter((v): v is string => !!v))].sort(),
  };

  return <ExerciseLibraryView items={items} filters={filters} />;
}
