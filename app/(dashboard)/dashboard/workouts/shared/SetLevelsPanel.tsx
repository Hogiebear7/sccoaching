"use client";

import { useMemo, useState } from "react";

import type { ExerciseRecord, WorkoutSessionRecord } from "@/lib/db";
import { computeMuscleSetLevels, SET_LEVEL_SECTIONS, type SetLevelTier } from "@/lib/workouts";
import { MuscleSetLevelDiagram } from "@/components/graphics/MuscleSetLevels";
import { SECTION_LABELS } from "./constants";

const WINDOW_OPTIONS: { days: number; label: string }[] = [
  { days: 7, label: "1 week" },
  { days: 28, label: "4 weeks" },
];

const TIER_LABEL: Record<SetLevelTier, string> = { none: "None", low: "Low", moderate: "Moderate", high: "High" };
const TIER_DOT_OPACITY: Record<Exclude<SetLevelTier, "none">, number> = { low: 0.38, moderate: 0.68, high: 1 };

function tierBadgeClass(tier: SetLevelTier): string {
  switch (tier) {
    case "high":
      return "bg-data/20 text-data";
    case "moderate":
      return "bg-data/12 text-data";
    case "low":
      return "bg-white/[0.06] text-zinc-400";
    default:
      return "bg-white/[0.03] text-zinc-600";
  }
}

// Aggregate training-balance view — how many sets each muscle group has
// gotten, averaged per week over a selectable window. Built on the same
// exerciseId → section lookup as the History muscle-map icons; free-text
// entries are honestly excluded rather than guessed at (see computeMuscleSetLevels).
export function SetLevelsPanel({
  sessions,
  exercises,
  todayISO,
}: {
  sessions: WorkoutSessionRecord[];
  exercises: ExerciseRecord[];
  todayISO: string;
}) {
  const [windowDays, setWindowDays] = useState(7);

  const sectionByExerciseId = useMemo(() => new Map(exercises.map((e) => [e.id, e.section])), [exercises]);

  const { levels, sessionsInWindow, resolvedSessions } = useMemo(
    () => computeMuscleSetLevels(sessions, sectionByExerciseId, windowDays, todayISO),
    [sessions, sectionByExerciseId, windowDays, todayISO]
  );

  const totalSets = SET_LEVEL_SECTIONS.reduce((sum, s) => sum + levels[s].weeklySets, 0);
  const unresolvedSessions = sessionsInWindow - resolvedSessions;

  return (
    <div className="surface-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Average weekly sets by muscle group, from exercises picked off the library.
        </p>
        <div className="flex items-center gap-1 rounded-full border border-white/[0.1] bg-white/[0.03] p-0.5">
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              type="button"
              aria-pressed={windowDays === opt.days}
              onClick={() => setWindowDays(opt.days)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                windowDays === opt.days ? "bg-data/15 text-data" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {totalSets === 0 ? (
        <div className="empty-state mt-4">
          <p className="text-sm font-medium">
            {sessionsInWindow === 0 ? "No sessions logged in this window" : "No library-linked sets in this window"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {sessionsInWindow === 0
              ? "Log a session to start seeing your set levels."
              : "Pick exercises from the library when logging to track them here — free-text entries aren't matched to a muscle group."}
          </p>
        </div>
      ) : (
        <>
          <MuscleSetLevelDiagram levels={levels} className="mt-4 h-44" />

          <div className="mt-3 flex items-center justify-center gap-4">
            {(["low", "moderate", "high"] as const).map((tier) => (
              <span key={tier} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: "var(--accent-data)", opacity: TIER_DOT_OPACITY[tier] }}
                />
                {TIER_LABEL[tier]}
              </span>
            ))}
          </div>

          <div className="mt-4 space-y-1.5">
            {SET_LEVEL_SECTIONS.map((section) => (
              <div
                key={section}
                className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
              >
                <span className="text-[13px] font-medium text-foreground">{SECTION_LABELS[section]}</span>
                <span className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                  {levels[section].weeklySets} sets/wk
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tierBadgeClass(levels[section].tier)}`}>
                    {TIER_LABEL[levels[section].tier]}
                  </span>
                </span>
              </div>
            ))}
          </div>

          {unresolvedSessions > 0 && (
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
              {unresolvedSessions} of {sessionsInWindow} session{sessionsInWindow === 1 ? "" : "s"} in this window had no
              library-linked exercises and aren&apos;t reflected above.
            </p>
          )}
        </>
      )}
    </div>
  );
}
