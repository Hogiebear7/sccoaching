"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { ExerciseRecord, WorkoutSessionRecord } from "@/lib/db";
import {
  computePersonalBests,
  computeWeeklyStreak,
  getExerciseTrend,
  weeklyWorkoutStats,
} from "@/lib/workouts";
import type { HelperContext } from "@/lib/workout-helper";
import { WorkoutHelper } from "./WorkoutHelper";
import { formatExerciseLoad } from "@/lib/workout-entries";
import { ClassSessionEditor } from "./shared/ClassSessionEditor";
import { ExerciseLibraryPanel } from "./shared/ExerciseLibraryPanel";
import { ExerciseLookupPanel } from "./shared/ExerciseLookupPanel";
import { TrendChart } from "./shared/TrendChart";
import { WorkoutLogForm } from "./shared/WorkoutLogForm";
import { formatRun, todayDateString } from "./shared/formatters";
import { computeCurrentWeekDays, computeWeeklyFrequency } from "./shared/consistency";
import { MuscleMap } from "@/components/graphics/MuscleMap";
import { SetLevelsPanel } from "./shared/SetLevelsPanel";

// Workouts — a real information-architecture rethink, not a reskin:
//
//   1. A tabbed hero (Plan / Log) replaces "helper card, then log card"
//      as two separate full-weight sections — the member picks their
//      intent once, and the other panel stays mounted-but-hidden so
//      in-progress form state survives a tab switch.
//   2. A two-column "Progress" band puts the streak/consistency module
//      and a horizontally-scrolling personal-records rail side by side
//      as one grouped unit, instead of each being its own top-level
//      section with its own header.
//   3. Exercise lookup + library — pure reference tools nobody needs on
//      every visit — are collapsed behind <details> at the bottom, quieter
//      and shorter by default rather than always fully expanded.
export function WorkoutsView({
  sessions,
  exercises,
  helperContext,
}: {
  sessions: WorkoutSessionRecord[];
  exercises: ExerciseRecord[];
  helperContext: HelperContext;
}) {
  const router = useRouter();
  const [editingClassSessionId, setEditingClassSessionId] = useState<string | null>(null);
  const [editingSelfSessionId, setEditingSelfSessionId] = useState<string | null>(null);
  const [heroTab, setHeroTab] = useState<"plan" | "log">("plan");
  const todayISO = todayDateString();

  // Logged exercises link to the library via exerciseId when the member
  // picked one from the autocomplete; free-text entries have exerciseId
  // null and simply don't get a muscle-map icon — showing one would be a
  // guess, not a fact. Section lookup only, no exercise data mutated.
  const sectionByExerciseId = useMemo(
    () => new Map(exercises.map((e) => [e.id, e.section])),
    [exercises]
  );

  const personalBests = useMemo(() => computePersonalBests(sessions), [sessions]);
  const weeklyStats = useMemo(() => weeklyWorkoutStats(sessions, todayISO), [sessions, todayISO]);
  const streakWeeks = useMemo(() => computeWeeklyStreak(sessions, todayISO), [sessions, todayISO]);
  const currentWeekDays = useMemo(() => computeCurrentWeekDays(sessions, todayISO), [sessions, todayISO]);
  const weeklyFrequency = useMemo(() => computeWeeklyFrequency(sessions, todayISO), [sessions, todayISO]);
  const maxWeekCount = Math.max(1, ...weeklyFrequency.map((w) => w.count));

  const [trackedExercises, setTrackedExercises] = useState<string[]>([]);
  const [trackInput, setTrackInput] = useState("");
  const [trackOpen, setTrackOpen] = useState(false);

  const trackCandidates = useMemo(
    () => personalBests.map((pb) => pb.exerciseName).filter((name) => !trackedExercises.includes(name)),
    [personalBests, trackedExercises]
  );
  const filteredCandidates = useMemo(
    () =>
      trackInput.trim()
        ? trackCandidates.filter((name) => name.toLowerCase().includes(trackInput.trim().toLowerCase()))
        : trackCandidates.slice(0, 8),
    [trackCandidates, trackInput]
  );
  const trendData = useMemo(
    () => Object.fromEntries(trackedExercises.map((name) => [name, getExerciseTrend(sessions, name)])),
    [sessions, trackedExercises]
  );

  function addTracked(name: string) {
    if (trackedExercises.length >= 5 || trackedExercises.includes(name)) return;
    setTrackedExercises((prev) => [...prev, name]);
    setTrackInput("");
    setTrackOpen(false);
  }
  function removeTracked(name: string) {
    setTrackedExercises((prev) => prev.filter((n) => n !== name));
  }

  return (
    <section className="anim-rise space-y-10">
      {/* Bespoke editorial header — echoes the marketing/dashboard voice
          rather than reusing the generic PageHeader every other screen
          shares, since the opening here is the tabbed hero below it, not
          a standalone header block. */}
      <div>
        <p className="text-mono text-[11px] uppercase tracking-[0.24em] text-gold">Training</p>
        <h1 className="text-editorial mt-2 text-[32px] leading-[1.05] text-zinc-50 sm:text-[36px]">
          Where today&rsquo;s session starts.
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Plan a session from your readiness and history, or log what you just did.
        </p>
      </div>

      {/* Hero — one dominant action zone, switched by intent rather than
          stacked. Both panels stay mounted so switching tabs never drops
          in-progress input in the log form. */}
      <div>
        <div className="mb-4 inline-flex rounded-full border border-white/[0.1] bg-white/[0.03] p-1">
          <button
            type="button"
            onClick={() => setHeroTab("plan")}
            className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition ${
              heroTab === "plan" ? "bg-primary text-primary-foreground" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Plan a session
          </button>
          <button
            type="button"
            onClick={() => setHeroTab("log")}
            className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition ${
              heroTab === "log" ? "bg-primary text-primary-foreground" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Log a session
          </button>
        </div>

        <div className={heroTab === "plan" ? "" : "hidden"}>
          <WorkoutHelper sessions={sessions} context={helperContext} />
        </div>
        <div className={heroTab === "log" ? "" : "hidden"}>
          <WorkoutLogForm exercises={exercises} />
        </div>
      </div>

      {/* Progress — streak/consistency and recent records grouped as one
          band with a single header, side by side on wider screens, instead
          of each being its own full-width top-level section. */}
      <div>
        <p className="mb-3 px-1 label-caps">Progress</p>
        <div className="grid min-w-0 gap-3 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="surface-card surface-card--accent min-w-0 p-5">
            <div className="flex items-baseline justify-between">
              <div>
                <p className="label-caps text-[9px]">Streak</p>
                <p className="text-editorial mt-2 text-[32px] leading-none text-gold">{streakWeeks}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {streakWeeks === 1 ? "week trained" : "weeks trained"} in a row
                </p>
              </div>
              <div className="text-right">
                <p className="text-display text-[20px] leading-none tabular-nums">{weeklyStats.count}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">this week</p>
              </div>
            </div>

            <div className="mt-4 flex justify-between gap-1">
              {currentWeekDays.map((d) => (
                <span
                  key={d.iso}
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums ${
                    d.trained
                      ? "bg-primary text-primary-foreground"
                      : d.isToday
                        ? "border border-primary/50 text-primary"
                        : "border border-white/[0.1] text-muted-foreground"
                  }`}
                  title={d.iso}
                >
                  {d.letter}
                </span>
              ))}
            </div>

            <div className="mt-4 flex items-end gap-1.5 border-t border-white/[0.06] pt-3.5" aria-hidden="true">
              {weeklyFrequency.map((w) => (
                <div key={w.mondayIso} className="flex-1">
                  <div
                    className={`w-full rounded-t ${w.mondayIso === weeklyFrequency[weeklyFrequency.length - 1].mondayIso ? "bg-primary" : "bg-white/[0.12]"}`}
                    style={{ height: `${Math.max(6, (w.count / maxWeekCount) * 26)}px` }}
                  />
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-zinc-600">6-week frequency</p>
          </div>

          <div className="surface-card min-w-0 p-5">
            <div className="flex items-baseline justify-between">
              <p className="label-caps text-[9px]">Recent records</p>
              <p className="text-[11px] text-muted-foreground tabular-nums">{sessions.length} sessions logged</p>
            </div>
            {personalBests.length === 0 ? (
              <div className="empty-state mt-3">
                <p className="text-sm font-medium">No personal bests yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Log exercises with sets, reps, or numeric weight to start tracking bests.
                </p>
              </div>
            ) : (
              <div className="mt-3 -mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-1 pb-1">
                {personalBests.map((pb) => (
                  <div
                    key={pb.exerciseName}
                    className="w-[136px] shrink-0 snap-start rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"
                  >
                    <p className="truncate text-[12px] font-semibold text-foreground">{pb.exerciseName}</p>
                    <p className="text-display mt-1.5 text-[18px] leading-none tabular-nums text-gold">
                      {pb.heaviestWeight
                        ? Number.isFinite(parseFloat(pb.heaviestWeight.weightStr))
                          ? `${pb.heaviestWeight.value} kg`
                          : pb.heaviestWeight.weightStr
                        : pb.highestReps
                          ? `×${pb.highestReps.reps}`
                          : "—"}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
                      {pb.heaviestWeight?.date ?? pb.highestReps?.date ?? ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Set levels — a real training-balance insight, not decoration:
          weekly logged sets per muscle group, resolved from the same
          exerciseId → section link the History icons use. Sits between
          Progress and History since it's the same kind of "how am I
          actually training" signal, just aggregated differently. */}
      <div>
        <p className="mb-3 px-1 label-caps">Set levels</p>
        <SetLevelsPanel sessions={sessions} exercises={exercises} todayISO={todayISO} />
      </div>

      {/* History — full session detail, kept substantive rather than
          demoted, since a logged session is real proof-of-work content
          and not just a reference tool. */}
      <div>
        <p className="mb-3 px-1 label-caps">History</p>

        {sessions.length === 0 ? (
          <div className="empty-state">
            <p className="text-sm font-medium">No workouts logged yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Log your first session above.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => (
              <div key={session.id} className="surface-card p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs text-muted-foreground">{session.date}</p>
                      {session.classId ? (
                        <span className="rounded-full border border-primary/25 bg-primary/[0.08] px-2 py-0.5 text-[10px] font-semibold text-primary">
                          Class
                        </span>
                      ) : null}
                      {session.classId && session.date === todayISO && editingClassSessionId !== session.id ? (
                        <button
                          type="button"
                          onClick={() => setEditingClassSessionId(session.id)}
                          className="text-[11px] font-medium text-primary transition hover:text-[var(--primary-hover)]"
                        >
                          Edit (today only)
                        </button>
                      ) : null}
                      {!session.classId && editingSelfSessionId !== session.id ? (
                        <button
                          type="button"
                          onClick={() => setEditingSelfSessionId(session.id)}
                          className="text-[11px] font-medium text-primary transition hover:text-[var(--primary-hover)]"
                        >
                          Edit
                        </button>
                      ) : null}
                    </div>
                    <h4 className="mt-1 text-base font-semibold">{session.title}</h4>
                    {editingClassSessionId === session.id ? (
                      <ClassSessionEditor
                        session={session}
                        onDone={() => {
                          setEditingClassSessionId(null);
                          router.refresh();
                        }}
                        onCancel={() => setEditingClassSessionId(null)}
                      />
                    ) : null}
                    {editingSelfSessionId === session.id ? (
                      <div className="mt-3">
                        <WorkoutLogForm
                          key={session.id}
                          exercises={exercises}
                          editingSession={session}
                          containerClassName="rounded-lg border border-border bg-secondary/10 p-4"
                          onSaved={() => setEditingSelfSessionId(null)}
                          onCancelEdit={() => setEditingSelfSessionId(null)}
                        />
                      </div>
                    ) : null}
                    {session.notes && <p className="mt-2 text-sm text-muted-foreground">{session.notes}</p>}
                    {(session.exercises.length > 0 || session.runs.length > 0) && (
                      <div className="mt-3 space-y-1 border-t border-border pt-3">
                        {session.exercises.map((ex, i) => {
                          const load = formatExerciseLoad(ex);
                          const section = ex.exerciseId ? sectionByExerciseId.get(ex.exerciseId) : undefined;
                          return (
                            <div key={i} className="flex items-baseline gap-2 text-sm">
                              {section && <MuscleMap section={section} className="h-4 w-3 shrink-0 self-center" />}
                              {ex.supersetGroup && (
                                <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                  {ex.supersetGroup}
                                </span>
                              )}
                              <span className="font-medium text-foreground">{ex.name}</span>
                              {load && <span className="text-xs text-muted-foreground">{load}</span>}
                            </div>
                          );
                        })}
                        {session.runs.map((run, i) => (
                          <div key={`run-${i}`} className="flex items-baseline gap-2 text-sm">
                            <span className="font-medium text-foreground">Run</span>
                            <span className="text-xs text-muted-foreground">{formatRun(run)}</span>
                            {run.notes && <span className="text-xs text-muted-foreground">— {run.notes}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {session.durationMins !== null && (
                    <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">
                      {session.durationMins} min
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Track progression — kept as its own light-touch tool, styled a
          notch quieter than History so it doesn't compete with it. */}
      <div>
        <div className="mb-2.5 flex items-baseline justify-between px-1">
          <p className="label-caps">Track progression</p>
          {trackedExercises.length > 0 && (
            <span className="text-[11px] text-muted-foreground tabular-nums">{trackedExercises.length}/5 tracked</span>
          )}
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
          {trackedExercises.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {trackedExercises.map((name) => (
                <span key={name} className="flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-medium text-secondary-foreground">
                  {name}
                  <button type="button" onClick={() => removeTracked(name)} className="leading-none text-muted-foreground transition hover:text-foreground" aria-label={`Remove ${name}`}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {trackedExercises.length < 5 ? (
            <div className="relative">
              <input
                type="text"
                value={trackInput}
                onChange={(e) => {
                  setTrackInput(e.target.value);
                  setTrackOpen(true);
                }}
                onFocus={() => setTrackOpen(true)}
                onBlur={() => setTimeout(() => setTrackOpen(false), 150)}
                placeholder={personalBests.length === 0 ? "Log exercises first to track progression" : "Add an exercise to track…"}
                disabled={personalBests.length === 0}
                className="w-full rounded-lg border border-border bg-input px-3.5 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {trackOpen && filteredCandidates.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                  {filteredCandidates.map((name) => (
                    <button key={name} type="button" onMouseDown={(e) => { e.preventDefault(); addTracked(name); }} className="w-full px-4 py-2.5 text-left text-sm text-foreground hover:bg-secondary">
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Maximum of 5 exercises reached. Remove one to add another.</p>
          )}

          {trackedExercises.length === 0 && personalBests.length > 0 && (
            <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">Pick up to 5 exercises from your history to chart progression.</p>
          )}
        </div>

        {trackedExercises.length > 0 && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {trackedExercises.map((name) => {
              const points = trendData[name] ?? [];
              const useWeight = points.some((p) => p.weightNum !== null);
              const hasReps = points.some((p) => p.reps !== null);
              const chartLabel = useWeight ? "Weight trend" : hasReps ? "Reps trend" : "";
              return (
                <div key={name} className="surface-card p-3.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[13px] font-semibold text-foreground">{name}</p>
                    {chartLabel && <p className="text-[11px] text-muted-foreground">{chartLabel}</p>}
                  </div>
                  <div className="mt-1.5">
                    <TrendChart points={points} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reference — pure lookup tools, collapsed by default. Nobody needs
          these open on every visit; progressive disclosure keeps the page
          short unless a member actually wants to browse or search. */}
      <div className="border-t border-white/[0.06] pt-6">
        <p className="mb-3 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">Reference</p>

        <details className="group rounded-xl border border-white/[0.06]">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-zinc-300 transition hover:text-zinc-100">
            Exercise lookup
            <span className="text-zinc-600 transition group-open:rotate-180">⌄</span>
          </summary>
          <div className="border-t border-white/[0.06] p-1">
            <ExerciseLookupPanel sessions={sessions} className="p-4" />
          </div>
        </details>

        <details className="group mt-2 rounded-xl border border-white/[0.06]">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-zinc-300 transition hover:text-zinc-100">
            Exercise library
            <span className="text-zinc-600 transition group-open:rotate-180">⌄</span>
          </summary>
          <div className="border-t border-white/[0.06] p-1">
            <ExerciseLibraryPanel exercises={exercises} sessions={sessions} className="p-4" />
          </div>
        </details>
      </div>
    </section>
  );
}
