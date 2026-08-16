"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import Button from "@/components/ui/Button";
import { ExerciseMediaSlot } from "@/components/ui/ExerciseMediaSlot";
import type { ExerciseLibraryRecord, ExerciseMediaRecord } from "@/lib/exercise-library/types";

type RelatedRef = { id: string; name: string; slug: string | null; score?: number; reasons?: string[]; types?: string[] };

export function ExerciseDetailView({
  exercise,
  media,
  favorited: initialFavorited,
  related,
}: {
  exercise: ExerciseLibraryRecord;
  media: ExerciseMediaRecord[];
  favorited: boolean;
  related: {
    similarExercises: RelatedRef[];
    substitutions: RelatedRef[];
    progressions: RelatedRef[];
    regressions: RelatedRef[];
  };
}) {
  const router = useRouter();
  const [favorited, setFavorited] = useState(initialFavorited);
  const [favoritePending, setFavoritePending] = useState(false);

  const heroMedia = media.find((m) => m.resolution === "720") ?? media.find((m) => m.resolution === "1080") ?? media[0];

  async function toggleFavorite() {
    const next = !favorited;
    setFavoritePending(true);
    setFavorited(next);
    try {
      const res = await fetch("/api/exercise-library/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseId: exercise.id, favorited: next }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setFavorited(!next);
    } finally {
      setFavoritePending(false);
    }
  }

  return (
    <div className="space-y-8">
      <Link href="/dashboard/exercise-library" className="text-sm text-muted-foreground hover:text-primary">
        ← Exercise Library
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <ExerciseMediaSlot
          seed={exercise.id}
          name={exercise.name}
          gifUrl={heroMedia?.url ?? null}
          className="aspect-square w-full rounded-xl lg:aspect-[4/5]"
        />

        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-editorial text-[30px] capitalize leading-[1.05] text-zinc-50">{exercise.name}</h1>
            <button
              onClick={toggleFavorite}
              disabled={favoritePending}
              className={`chip label-caps ${favorited ? "border-primary !text-primary" : ""}`}
            >
              {favorited ? "★ Favorited" : "☆ Favorite"}
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {[exercise.bodyPart, exercise.equipment, exercise.category, exercise.difficulty]
              .filter(Boolean)
              .map((v) => (
                <span key={v} className="chip label-caps capitalize">
                  {v}
                </span>
              ))}
          </div>

          {exercise.description ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{exercise.description}</p>
          ) : null}

          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            {exercise.targetMuscle ? (
              <span>
                Target: <span className="capitalize text-foreground">{exercise.targetMuscle}</span>
              </span>
            ) : null}
            {exercise.secondaryMuscles.length > 0 ? (
              <span>
                Secondary: <span className="capitalize text-foreground">{exercise.secondaryMuscles.join(", ")}</span>
              </span>
            ) : null}
          </div>

          <Button
            variant="primary"
            onClick={() => router.push(`/dashboard/workouts?logExercise=${encodeURIComponent(exercise.name)}`)}
          >
            Log this exercise
          </Button>
        </div>
      </div>

      {exercise.instructions.length > 0 ? (
        <div className="surface-card space-y-3 p-5">
          <p className="label-caps">How to perform it</p>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
            {exercise.instructions.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}

      <RelatedSection title="Substitutions" items={related.substitutions} />
      <RelatedSection title="Similar exercises" items={related.similarExercises} />
      <RelatedSection title="Progressions" items={related.progressions} />
      <RelatedSection title="Regressions" items={related.regressions} />
    </div>
  );
}

function RelatedSection({ title, items }: { title: string; items: RelatedRef[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="label-caps">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) =>
          item.slug ? (
            <Link key={item.id} href={`/dashboard/exercise-library/${item.slug}`} className="chip capitalize hover:border-primary hover:text-primary">
              {item.name}
            </Link>
          ) : (
            <span key={item.id} className="chip capitalize opacity-60">
              {item.name}
            </span>
          )
        )}
      </div>
    </div>
  );
}
