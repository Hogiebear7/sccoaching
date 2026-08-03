"use client";

import { useMemo, useState } from "react";

import type { WorkoutSessionRecord } from "@/lib/db";
import { findExerciseHistory } from "@/lib/workouts";

// "What did I last do for X" search — shared by both view variants, kept
// separate from the log form since its only dependency is `sessions`.
export function ExerciseLookupPanel({
  sessions,
  className = "surface-card p-5",
}: {
  sessions: WorkoutSessionRecord[];
  className?: string;
}) {
  const [lookupQuery, setLookupQuery] = useState("");

  const lookupResults = useMemo(
    () => findExerciseHistory(sessions, lookupQuery),
    [sessions, lookupQuery]
  );

  const latestMatch = lookupResults[0] ?? null;
  const latestMatchParts = latestMatch
    ? [
        latestMatch.sets ? `${latestMatch.sets} sets` : null,
        latestMatch.reps ? `${latestMatch.reps} reps` : null,
        latestMatch.weight ?? null,
      ].filter((x): x is string => Boolean(x))
    : [];

  return (
    <div className={className}>
      <p className="mb-3 label-caps">Exercise lookup</p>
      <input
        type="text"
        value={lookupQuery}
        onChange={(e) => setLookupQuery(e.target.value)}
        placeholder="Search exercise history…"
        className="w-full rounded-lg border border-border bg-input px-4 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
      />
      {lookupQuery.trim() === "" ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Type an exercise name to see your last performance.
        </p>
      ) : latestMatch === null ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No history found for &ldquo;{lookupQuery.trim()}&rdquo;.
        </p>
      ) : (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">
            Last performed &mdash;{" "}
            {lookupResults.length === 1 ? "1 entry" : `${lookupResults.length} entries`} found
          </p>
          <div className="mt-2 rounded-lg border border-border bg-secondary/20 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-muted-foreground">{latestMatch.date}</p>
                <p className="mt-0.5 text-sm font-medium text-foreground">
                  {latestMatch.sessionTitle}
                </p>
                {latestMatch.notes && (
                  <p className="mt-1 text-xs text-muted-foreground">{latestMatch.notes}</p>
                )}
              </div>
              {latestMatchParts.length > 0 && (
                <p className="shrink-0 text-sm font-semibold text-foreground">
                  {latestMatchParts.join(" · ")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
