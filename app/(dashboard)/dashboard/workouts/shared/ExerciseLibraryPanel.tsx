"use client";

import { useState } from "react";

import type { ExerciseRecord, ExerciseSection, WorkoutSessionRecord } from "@/lib/db";
import { MuscleMap, MuscleMapDual, MUSCLE_GROUP_LABEL } from "@/components/graphics/MuscleMap";
import { SECTION_LABELS } from "./constants";

// Browsable, searchable view of the admin-managed exercise library with the
// member's own stats per exercise on tap. Shared by both view variants —
// there is only one library/lookup implementation; variants only choose the
// surrounding surface classes via `className`.
export function ExerciseLibraryPanel({
  exercises,
  sessions,
  className = "surface-card p-5",
}: {
  exercises: ExerciseRecord[];
  sessions: WorkoutSessionRecord[];
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<ExerciseSection | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = exercises
    .filter((e) => section === "all" || e.section === section)
    .filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  function statsFor(name: string) {
    let times = 0;
    let best: number | null = null;
    let bestStr: string | null = null;
    let last: string | null = null;
    for (const session of sessions) {
      for (const ex of session.exercises) {
        if (ex.name.trim().toLowerCase() !== name.trim().toLowerCase()) continue;
        times += 1;
        if (last === null || session.date > last) last = session.date;
        const sets = ex.setDetails && ex.setDetails.length > 0 ? ex.setDetails : [{ weight: ex.weight }];
        for (const set of sets) {
          if (!set.weight) continue;
          const w = parseFloat(set.weight);
          if (Number.isFinite(w) && (best === null || w > best)) {
            best = w;
            bestStr = set.weight;
          }
        }
      }
    }
    return { times, bestStr, last };
  }

  const sectionChips: { value: ExerciseSection | "all"; label: string }[] = [
    { value: "all", label: "All" },
    ...(Object.entries(SECTION_LABELS) as [ExerciseSection, string][]).map(([value, label]) => ({ value, label })),
  ];

  return (
    <div className={className}>
      <p className="mb-1 label-caps">Exercise library</p>
      <p className="mb-3 text-xs text-muted-foreground">
        The club&apos;s exercise list — tap one to see your own numbers for it.
      </p>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search the library…"
        aria-label="Search the exercise library"
        className="w-full rounded-lg border border-border bg-input px-4 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
      />
      {/* Uniform grid keeps the chips aligned across wraps on mobile. */}
      <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-4" role="group" aria-label="Filter by category">
        {sectionChips.map((chip) => (
          <button
            key={chip.value}
            type="button"
            aria-pressed={section === chip.value}
            onClick={() => setSection(chip.value)}
            className={`truncate rounded-full border px-2 py-1.5 text-center text-xs font-medium transition ${
              section === chip.value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground tabular-nums">
        {filtered.length} exercise{filtered.length === 1 ? "" : "s"}
      </p>
      <div className="mt-1.5 max-h-72 space-y-1.5 overflow-y-auto overscroll-contain rounded-xl border border-border/40 bg-white/[0.02] p-1.5">
        {filtered.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">No exercises match.</p>
        ) : (
          filtered.map((exercise) => {
            const open = openId === exercise.id;
            return (
              <div key={exercise.id} className="rounded-lg border border-border/60 bg-white/[0.02]">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : exercise.id)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left"
                >
                  <MuscleMap section={exercise.section} className="h-8 w-6 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">{exercise.name}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {SECTION_LABELS[exercise.section]}
                  </span>
                </button>
                {open ? (
                  <div className="space-y-3 border-t border-border/60 px-3 py-3 text-xs text-muted-foreground">
                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                      <MuscleMapDual section={exercise.section} className="h-32" />
                      <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground">{MUSCLE_GROUP_LABEL[exercise.section].primary}</span> primarily
                        <br />{MUSCLE_GROUP_LABEL[exercise.section].secondary} secondarily
                      </p>
                    </div>
                    {exercise.description ? (
                      <p className="leading-relaxed">{exercise.description}</p>
                    ) : null}
                    {exercise.cues ? (
                      <div>
                        <p className="mb-0.5 font-semibold text-foreground/80">Coaching cues</p>
                        <ul className="space-y-0.5">
                          {exercise.cues.split("\n").filter(Boolean).map((cue, i) => (
                            <li key={i}>· {cue}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {(() => {
                      const stat = statsFor(exercise.name);
                      if (stat.times === 0) return <>You haven&apos;t logged this one yet.</>;
                      return (
                        <>
                          Logged {stat.times} time{stat.times === 1 ? "" : "s"}
                          {stat.bestStr ? <> · best <span className="font-semibold text-foreground">{stat.bestStr}</span></> : null}
                          {stat.last ? <> · last {stat.last}</> : null}
                        </>
                      );
                    })()}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
