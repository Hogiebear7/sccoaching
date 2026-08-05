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

  // Newest first, most recent 3 instances only — this is a "what did I just
  // do" lookup, not a full history browser (that's the History list below).
  const recentMatches = [...lookupResults].reverse().slice(0, 3);

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
          Type an exercise name to see your last performances.
        </p>
      ) : recentMatches.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No history found for &ldquo;{lookupQuery.trim()}&rdquo;.
        </p>
      ) : (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">
            Last {recentMatches.length === 1 ? "performance" : `${recentMatches.length} performances`}
            {lookupResults.length > recentMatches.length
              ? ` (of ${lookupResults.length} logged)`
              : ""}
          </p>
          <div className="mt-2 space-y-2">
            {recentMatches.map((entry, i) => {
              const parts = [
                entry.sets ? `${entry.sets} sets` : null,
                entry.reps ? `${entry.reps} reps` : null,
                entry.weight ?? null,
              ].filter((x): x is string => Boolean(x));

              return (
                <div key={i} className="rounded-lg border border-border bg-secondary/20 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">{entry.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {entry.date} · {entry.sessionTitle}
                      </p>
                      {entry.notes && (
                        <p className="mt-1 text-xs text-muted-foreground">{entry.notes}</p>
                      )}
                    </div>
                    {parts.length > 0 && (
                      <p className="shrink-0 text-sm font-semibold text-foreground">
                        {parts.join(" · ")}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
