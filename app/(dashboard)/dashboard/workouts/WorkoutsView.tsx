"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

import type { ExerciseRecord, ExerciseSection, WorkoutRunEntry, WorkoutSessionRecord } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { weeklyWorkoutStats } from "@/lib/workouts";
import type { HelperContext } from "@/lib/workout-helper";
import { WorkoutHelper } from "./WorkoutHelper";
import {
  computePersonalBests,
  findExerciseHistory,
  getExerciseTrend,
  type ExerciseTrendPoint,
} from "@/lib/workouts";

const SECTION_LABELS: Record<ExerciseSection, string> = {
  upper_push: "Upper — Push",
  upper_pull: "Upper — Pull",
  lower_push: "Lower — Push",
  lower_pull: "Lower — Pull",
};

// --- Types ---

type WorkoutFormValues = {
  title: string;
  date: string;
  durationMins: string;
  notes: string;
};

type FormErrors = Partial<Record<keyof WorkoutFormValues, string>>;

type ExerciseRow = {
  key: string;
  exerciseId: string | null;
  name: string;
  weight: string;
  reps: string;
  sets: string;
  notes: string;
};

type RunRow = {
  key: string;
  distance: string;
  distanceUnit: "km" | "m";
  duration: string; // MM:SS or H:MM:SS user input
  reps: string;
  sets: string;
  notes: string;
};

// --- Helpers ---

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyFormValues(): WorkoutFormValues {
  return { title: "", date: todayDateString(), durationMins: "", notes: "" };
}

function newRow(): ExerciseRow {
  return { key: crypto.randomUUID(), exerciseId: null, name: "", weight: "", reps: "", sets: "", notes: "" };
}

function newRunRow(): RunRow {
  return { key: crypto.randomUUID(), distance: "", distanceUnit: "km", duration: "", reps: "", sets: "", notes: "" };
}

// Parses "MM:SS" or "H:MM:SS" → total seconds, or a bare number as minutes.
// Returns null if the input is empty or unparseable.
function parseDuration(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const parts = s.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) {
    const [m, sec] = parts;
    if (sec >= 60) return null;
    return m * 60 + sec;
  }
  if (parts.length === 3) {
    const [h, m, sec] = parts;
    if (m >= 60 || sec >= 60) return null;
    return h * 3600 + m * 60 + sec;
  }
  // bare number treated as minutes
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : null;
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Live pace preview for the run input. Both fields must independently parse
// to positive values — a missing or garbled side shows nothing rather than a
// misleading number. Metre distances convert to km first.
function livePace(distanceRaw: string, distanceUnit: "km" | "m", durationRaw: string): string | null {
  const rawDistance = parseFloat(distanceRaw);
  if (!Number.isFinite(rawDistance) || rawDistance <= 0) return null;
  const km = distanceUnit === "m" ? rawDistance / 1000 : rawDistance;

  const secs = parseDuration(durationRaw);
  if (secs === null || secs <= 0) return null;

  const paceSecs = Math.round(secs / km);
  return `${Math.floor(paceSecs / 60)}:${String(paceSecs % 60).padStart(2, "0")} /km`;
}

function formatRun(run: WorkoutRunEntry): string {
  const parts: string[] = [];
  if (run.distance !== null) parts.push(`${run.distance} ${run.distanceUnit}`);
  if (run.durationSecs !== null) parts.push(formatDuration(run.durationSecs));
  // Pace only when both sides of the division exist — never inferred.
  if (run.distance !== null && run.distance > 0 && run.durationSecs !== null && run.durationSecs > 0) {
    const paceSecs = Math.round(run.durationSecs / run.distance);
    parts.push(`${Math.floor(paceSecs / 60)}:${String(paceSecs % 60).padStart(2, "0")} /km`);
  }
  if (run.sets !== null && run.reps !== null) parts.push(`${run.sets}×${run.reps}`);
  else if (run.sets !== null) parts.push(`${run.sets} sets`);
  else if (run.reps !== null) parts.push(`${run.reps} reps`);
  return parts.join(" · ");
}

// --- ExerciseAutocomplete ---
// Defined at module level so React doesn't recreate it on every WorkoutsView render.

function ExerciseAutocomplete({
  exercises,
  value,
  onChange,
}: {
  exercises: ExerciseRecord[];
  value: string;
  onChange: (name: string, exerciseId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  const suggestions =
    value.trim().length > 0
      ? exercises
          .filter((e) => e.name.toLowerCase().includes(value.trim().toLowerCase()))
          .slice(0, 8)
      : [];

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value, null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="e.g. Bench Press"
        className="w-full rounded-lg border border-border bg-input px-4 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault(); // prevent blur before selection registers
                onChange(s.name, s.id);
                setOpen(false);
              }}
              className="flex w-full items-baseline gap-2 px-4 py-2.5 text-left text-sm hover:bg-secondary"
            >
              <span className="font-medium text-foreground">{s.name}</span>
              <span className="text-xs text-muted-foreground">{SECTION_LABELS[s.section]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- TrendChart ---

const CHART_W = 400;
const CHART_H = 120;
const PAD = { top: 20, right: 16, bottom: 28, left: 36 };

function TrendChart({ points }: { points: ExerciseTrendPoint[] }) {
  const useWeight = points.some((p) => p.weightNum !== null);
  const chartPoints = useWeight
    ? points.filter((p) => p.weightNum !== null)
    : points.filter((p) => p.reps !== null);

  if (chartPoints.length < 2) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        Not enough data to show a trend.
      </p>
    );
  }

  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;

  const yVals = chartPoints.map((p) =>
    useWeight ? (p.weightNum as number) : (p.reps as number)
  );
  const minY = Math.min(...yVals);
  const maxY = Math.max(...yVals);
  const yRange = maxY === minY ? 1 : maxY - minY;

  const toX = (i: number) =>
    PAD.left +
    (chartPoints.length === 1 ? innerW / 2 : (i / (chartPoints.length - 1)) * innerW);
  const toY = (val: number) =>
    PAD.top + innerH - ((val - minY) / yRange) * innerH;

  const plotted = chartPoints.map((p, i) => {
    const yVal = useWeight ? (p.weightNum as number) : (p.reps as number);
    return {
      x: toX(i),
      y: toY(yVal),
      label: useWeight ? (p.rawWeight ?? "") : String(p.reps ?? ""),
      date: p.date,
    };
  });

  const polylinePoints = plotted.map((p) => `${p.x},${p.y}`).join(" ");
  const labelStep = Math.max(1, Math.ceil(chartPoints.length / 5));

  function shortDate(iso: string): string {
    const [, m, d] = iso.split("-").map(Number);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[m - 1]} ${d}`;
  }

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      width="100%"
      className="overflow-visible text-foreground"
      aria-hidden="true"
    >
      <line
        x1={PAD.left} y1={PAD.top}
        x2={PAD.left} y2={PAD.top + innerH}
        stroke="currentColor" strokeOpacity={0.12} strokeWidth={1}
      />
      <line
        x1={PAD.left} y1={PAD.top + innerH}
        x2={PAD.left + innerW} y2={PAD.top + innerH}
        stroke="currentColor" strokeOpacity={0.12} strokeWidth={1}
      />
      <polyline
        points={polylinePoints}
        fill="none"
        style={{ stroke: "var(--primary)" }}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {plotted.map(({ x, y, label, date }, i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={3.5} style={{ fill: "var(--primary)" }} />
          <text x={x} y={y - 7} textAnchor="middle" fontSize={8} fill="currentColor" opacity={0.65}>
            {label}
          </text>
          {i % labelStep === 0 && (
            <text
              x={x}
              y={PAD.top + innerH + 14}
              textAnchor="middle"
              fontSize={8}
              fill="currentColor"
              opacity={0.45}
            >
              {shortDate(date)}
            </text>
          )}
        </g>
      ))}
      <text
        x={PAD.left - 4} y={PAD.top}
        textAnchor="end" dominantBaseline="middle"
        fontSize={8} fill="currentColor" opacity={0.45}
      >
        {maxY}
      </text>
      <text
        x={PAD.left - 4} y={PAD.top + innerH}
        textAnchor="end" dominantBaseline="middle"
        fontSize={8} fill="currentColor" opacity={0.45}
      >
        {minY}
      </text>
    </svg>
  );
}

// --- WorkoutsView ---

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

  const [values, setValues] = useState<WorkoutFormValues>(() => emptyFormValues());
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [exerciseRows, setExerciseRows] = useState<ExerciseRow[]>([]);
  const [runRows, setRunRows] = useState<RunRow[]>([]);
  const [lookupQuery, setLookupQuery] = useState("");

  const lookupResults = useMemo(
    () => findExerciseHistory(sessions, lookupQuery),
    [sessions, lookupQuery]
  );

  const personalBests = useMemo(() => computePersonalBests(sessions), [sessions]);
  const weeklyStats = useMemo(
    () => weeklyWorkoutStats(sessions, new Date().toISOString().slice(0, 10)),
    [sessions]
  );

  // Pre-compute display parts for the most recent lookup match to avoid
  // duplicating the filter logic in JSX.
  const latestMatch = lookupResults[0] ?? null;
  const latestMatchParts = latestMatch
    ? [
        latestMatch.sets ? `${latestMatch.sets} sets` : null,
        latestMatch.reps ? `${latestMatch.reps} reps` : null,
        latestMatch.weight ?? null,
      ].filter((x): x is string => Boolean(x))
    : [];

  const [trackedExercises, setTrackedExercises] = useState<string[]>([]);
  const [trackInput, setTrackInput] = useState("");
  const [trackOpen, setTrackOpen] = useState(false);

  // Exercises available to add: from history, not already tracked.
  const trackCandidates = useMemo(
    () =>
      personalBests
        .map((pb) => pb.exerciseName)
        .filter((name) => !trackedExercises.includes(name)),
    [personalBests, trackedExercises]
  );

  const filteredCandidates = useMemo(
    () =>
      trackInput.trim()
        ? trackCandidates.filter((name) =>
            name.toLowerCase().includes(trackInput.trim().toLowerCase())
          )
        : trackCandidates.slice(0, 8),
    [trackCandidates, trackInput]
  );

  const trendData = useMemo(
    () =>
      Object.fromEntries(
        trackedExercises.map((name) => [name, getExerciseTrend(sessions, name)])
      ),
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

  function handleTextChange(
    key: keyof WorkoutFormValues,
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    setValues((prev) => ({ ...prev, [key]: e.target.value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setSuccessMessage(null);
  }

  function updateRow(key: string, patch: Partial<Omit<ExerciseRow, "key">>) {
    setExerciseRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row))
    );
  }

  function removeRow(key: string) {
    setExerciseRows((prev) => prev.filter((row) => row.key !== key));
  }

  function updateRunRow(key: string, patch: Partial<Omit<RunRow, "key">>) {
    setRunRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row))
    );
  }

  function removeRunRow(key: string) {
    setRunRows((prev) => prev.filter((row) => row.key !== key));
  }

  function validate(): boolean {
    const nextErrors: FormErrors = {};
    if (!values.title.trim()) nextErrors.title = "Title is required.";
    if (!values.date.trim()) nextErrors.date = "Date is required.";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validate()) return;

    setFormError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    // Rows with an empty name are silently dropped.
    const exercisesToSend = exerciseRows
      .filter((row) => row.name.trim())
      .map((row) => ({
        exerciseId: row.exerciseId,
        name: row.name.trim(),
        weight: row.weight.trim() || null,
        reps: row.reps.trim() ? parseInt(row.reps, 10) : null,
        sets: row.sets.trim() ? parseInt(row.sets, 10) : null,
        notes: row.notes.trim() || null,
      }));

    // Run rows with neither distance nor duration are silently dropped (API also drops them).
    const runsToSend = runRows.map((row) => ({
      // Metres are converted on save — km stays the canonical stored unit.
      distance: row.distance.trim()
        ? row.distanceUnit === "m"
          ? Math.round((parseFloat(row.distance) / 1000) * 1000) / 1000
          : parseFloat(row.distance)
        : null,
      distanceUnit: "km" as const,
      durationSecs: parseDuration(row.duration),
      reps: row.reps.trim() ? parseInt(row.reps, 10) : null,
      sets: row.sets.trim() ? parseInt(row.sets, 10) : null,
      notes: row.notes.trim() || null,
    }));

    try {
      const res = await fetch("/api/workouts/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, exercises: exercisesToSend, runs: runsToSend }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setFormError(data?.message ?? "Could not log workout. Please try again.");
        return;
      }

      setSuccessMessage(data?.message ?? "Workout logged.");
      setValues(emptyFormValues());
      setExerciseRows([]);
      setRunRows([]);
      router.refresh();
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="space-y-8">

      <PageHeader
        eyebrow="Training"
        title="Workouts"
        subtitle="Record your training sessions and keep a history over time."
      />

      {/* Summary stats — compact weekly row */}
      <div className="panel grid grid-cols-3 divide-x divide-white/[0.06]">
        <div className="px-3 py-3.5 text-center sm:px-4">
          <p className="label-caps text-[9px]">This week</p>
          <p className="text-display mt-1.5 text-[20px] leading-none tabular-nums">{weeklyStats.count}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">workout{weeklyStats.count === 1 ? "" : "s"}</p>
        </div>
        <div className="px-3 py-3.5 text-center sm:px-4">
          <p className="label-caps text-[9px]">Volume</p>
          <p className="text-display mt-1.5 text-[20px] leading-none tabular-nums">
            {weeklyStats.totalKg > 0 ? weeklyStats.totalKg.toLocaleString("en-GB") : "—"}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">kg lifted this week</p>
        </div>
        <div className="px-3 py-3.5 text-center sm:px-4">
          <p className="label-caps text-[9px]">All time</p>
          <p className="text-display mt-1.5 text-[20px] leading-none tabular-nums">{sessions.length}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">sessions logged</p>
        </div>
      </div>

      {/* Workout Helper */}
      <WorkoutHelper sessions={sessions} context={helperContext} />

      {/* Exercise lookup */}
      <div className="panel p-5">
        <p className="mb-3 label-caps">
          Exercise lookup
        </p>
        <input
          type="text"
          value={lookupQuery}
          onChange={(e) => setLookupQuery(e.target.value)}
          placeholder="Search exercise history…"
          className="w-full rounded-lg border border-border bg-input px-4 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
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

      {/* Log form */}
      <form
        onSubmit={handleSubmit}
        className="panel p-5"
      >
        <p className="mb-4 label-caps">
          Log a workout
        </p>

        {formError && (
          <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {formError}
          </p>
        )}

        {successMessage && (
          <p className="mb-4 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
            {successMessage}
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Title" error={errors.title}>
            <input
              type="text"
              value={values.title}
              onChange={(e) => handleTextChange("title", e)}
              className={inputClass(errors.title)}
              placeholder="e.g. Lower Body Strength"
            />
          </FormField>

          <FormField label="Date" error={errors.date}>
            <input
              type="date"
              value={values.date}
              onChange={(e) => handleTextChange("date", e)}
              className={inputClass(errors.date)}
            />
          </FormField>

          <FormField
            label={
              <>
                Duration (minutes){" "}
                <span className="text-xs font-normal text-muted-foreground">optional</span>
              </>
            }
            error={errors.durationMins}
          >
            <input
              type="number"
              min={0}
              value={values.durationMins}
              onChange={(e) => handleTextChange("durationMins", e)}
              className={inputClass(errors.durationMins)}
              placeholder="e.g. 60"
            />
          </FormField>

          <div className="md:col-span-2">
            <FormField
              label={
                <>
                  Notes{" "}
                  <span className="text-xs font-normal text-muted-foreground">optional</span>
                </>
              }
              error={errors.notes}
            >
              <textarea
                value={values.notes}
                onChange={(e) => handleTextChange("notes", e)}
                className={`${inputClass(errors.notes)} min-h-[80px] resize-y`}
                placeholder="What did you do, how did it feel, anything worth remembering"
              />
            </FormField>
          </div>
        </div>

        {/* Session entry rows */}
        <div className="mt-6 border-t border-border pt-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="label-caps">Session entries</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setExerciseRows((prev) => [...prev, newRow()])}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-primary hover:text-primary"
              >
                + Add exercise
              </button>
              <button
                type="button"
                onClick={() => setRunRows((prev) => [...prev, newRunRow()])}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-primary hover:text-primary"
              >
                + Add run
              </button>
            </div>
          </div>

          {exerciseRows.length === 0 && runRows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
              No entries added yet. Use the buttons above to log exercises or a run.
            </p>
          ) : (
            <div className="space-y-3">
              {exerciseRows.map((row, idx) => (
                <div
                  key={row.key}
                  className="rounded-lg border border-border bg-secondary/20 p-4"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">
                      Exercise {idx + 1}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      className="text-xs text-muted-foreground transition hover:text-destructive"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <span className="mb-1.5 block text-xs font-medium text-foreground">
                        Exercise name
                      </span>
                      <ExerciseAutocomplete
                        exercises={exercises}
                        value={row.name}
                        onChange={(name, exerciseId) => updateRow(row.key, { name, exerciseId })}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-foreground">
                          Weight / time
                        </label>
                        <input
                          type="text"
                          value={row.weight}
                          onChange={(e) => updateRow(row.key, { weight: e.target.value })}
                          placeholder="e.g. 60 kg"
                          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-foreground">
                          Reps
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={row.reps}
                          onChange={(e) => updateRow(row.key, { reps: e.target.value })}
                          placeholder="e.g. 8"
                          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-foreground">
                          Sets
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={row.sets}
                          onChange={(e) => updateRow(row.key, { sets: e.target.value })}
                          placeholder="e.g. 3"
                          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-foreground">
                        Notes{" "}
                        <span className="font-normal text-muted-foreground">optional</span>
                      </label>
                      <input
                        type="text"
                        value={row.notes}
                        onChange={(e) => updateRow(row.key, { notes: e.target.value })}
                        placeholder="e.g. Felt strong, could go heavier"
                        className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
                      />
                    </div>
                  </div>
                </div>
              ))}

              {runRows.map((row, idx) => (
                <div
                  key={row.key}
                  className="rounded-lg border border-border bg-secondary/20 p-4"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">
                      Run {idx + 1}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeRunRow(row.key)}
                      className="text-xs text-muted-foreground transition hover:text-destructive"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-foreground">
                          Distance{" "}
                          <span className="font-normal text-muted-foreground">optional</span>
                        </label>
                        <div className="flex gap-1.5">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={row.distance}
                            onChange={(e) => updateRunRow(row.key, { distance: e.target.value })}
                            placeholder={row.distanceUnit === "m" ? "e.g. 400" : "e.g. 5.2"}
                            className="w-full min-w-0 rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
                          />
                          <select
                            value={row.distanceUnit}
                            onChange={(e) =>
                              updateRunRow(row.key, { distanceUnit: e.target.value as "km" | "m" })
                            }
                            aria-label="Distance unit"
                            className="w-16 shrink-0 rounded-lg border border-border bg-input px-2 py-2 text-sm text-foreground outline-none transition focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
                          >
                            <option value="km">km</option>
                            <option value="m">m</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-foreground">
                          Time (mm:ss){" "}
                          <span className="font-normal text-muted-foreground">optional</span>
                        </label>
                        <input
                          type="text"
                          value={row.duration}
                          onChange={(e) => updateRunRow(row.key, { duration: e.target.value })}
                          placeholder="e.g. 30:00"
                          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
                        />
                      </div>
                    </div>

                    {/* Live pace — appears only once distance and time both parse */}
                    {livePace(row.distance, row.distanceUnit, row.duration) ? (
                      <p aria-live="polite" className="text-xs text-muted-foreground">
                        Pace:{" "}
                        <span className="font-semibold text-primary tabular-nums">
                          {livePace(row.distance, row.distanceUnit, row.duration)}
                        </span>
                      </p>
                    ) : null}

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-foreground">
                          Reps{" "}
                          <span className="font-normal text-muted-foreground">optional</span>
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={row.reps}
                          onChange={(e) => updateRunRow(row.key, { reps: e.target.value })}
                          placeholder="e.g. 8"
                          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-foreground">
                          Sets{" "}
                          <span className="font-normal text-muted-foreground">optional</span>
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={row.sets}
                          onChange={(e) => updateRunRow(row.key, { sets: e.target.value })}
                          placeholder="e.g. 3"
                          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-foreground">
                        Notes{" "}
                        <span className="font-normal text-muted-foreground">optional</span>
                      </label>
                      <input
                        type="text"
                        value={row.notes}
                        onChange={(e) => updateRunRow(row.key, { notes: e.target.value })}
                        placeholder="e.g. Easy pace, felt good"
                        className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end border-t border-border pt-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary px-5 py-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Saving…" : "Log workout"}
          </button>
        </div>
      </form>

      {/* History */}
      <div>
        <p className="mb-3 px-1 label-caps">
          History
        </p>

        {sessions.length === 0 ? (
          <div className="empty-state">
            <p className="text-sm font-medium">No workouts logged yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Log your first session above.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="panel p-4"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">{session.date}</p>
                    <h4 className="mt-1 text-base font-semibold">{session.title}</h4>
                    {session.notes && (
                      <p className="mt-2 text-sm text-muted-foreground">{session.notes}</p>
                    )}
                    {(session.exercises.length > 0 || session.runs.length > 0) && (
                      <div className="mt-3 space-y-1 border-t border-border pt-3">
                        {session.exercises.map((ex, i) => {
                          const parts = [
                            ex.sets ? `${ex.sets} sets` : null,
                            ex.reps ? `${ex.reps} reps` : null,
                            ex.weight ?? null,
                          ].filter(Boolean);
                          return (
                            <div key={i} className="flex items-baseline gap-2 text-sm">
                              <span className="font-medium text-foreground">{ex.name}</span>
                              {parts.length > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  {parts.join(" · ")}
                                </span>
                              )}
                            </div>
                          );
                        })}
                        {session.runs.map((run, i) => (
                          <div key={`run-${i}`} className="flex items-baseline gap-2 text-sm">
                            <span className="font-medium text-foreground">Run</span>
                            <span className="text-xs text-muted-foreground">
                              {formatRun(run)}
                            </span>
                            {run.notes && (
                              <span className="text-xs text-muted-foreground">— {run.notes}</span>
                            )}
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

      {/* Personal bests */}
      <div>
        <p className="mb-3 px-1 label-caps">
          Personal bests
        </p>
        {personalBests.length === 0 ? (
          <div className="empty-state">
            <p className="text-sm font-medium">No personal bests yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Log exercises with sets, reps, or numeric weight to start tracking bests.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {personalBests.map((pb) => (
              <div
                key={pb.exerciseName}
                className="panel p-4"
              >
                <p className="text-sm font-semibold text-foreground">{pb.exerciseName}</p>
                {pb.heaviestWeight ? (
                  <>
                    <p className="text-display mt-2 text-[22px] leading-none tabular-nums">
                      {Number.isFinite(parseFloat(pb.heaviestWeight.weightStr))
                        ? `${pb.heaviestWeight.value} kg`
                        : pb.heaviestWeight.weightStr}
                      {pb.heaviestWeight.reps !== null && (
                        <span className="ml-1.5 text-sm font-normal tracking-normal text-muted-foreground">
                          ({pb.heaviestWeight.reps} rep{pb.heaviestWeight.reps === 1 ? "" : "s"})
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                      {pb.heaviestWeight.date}
                      {pb.highestReps && pb.highestReps.reps !== pb.heaviestWeight.reps
                        ? ` · best reps ×${pb.highestReps.reps}`
                        : ""}
                    </p>
                  </>
                ) : pb.highestReps ? (
                  <>
                    <p className="text-display mt-2 text-[22px] leading-none tabular-nums">
                      ×{pb.highestReps.reps}
                      <span className="ml-1.5 text-sm font-normal tracking-normal text-muted-foreground">
                        (reps)
                      </span>
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">{pb.highestReps.date}</p>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Track progression */}
      <div>
        <div className="mb-2.5 flex items-baseline justify-between px-1">
          <p className="label-caps">Track progression</p>
          {trackedExercises.length > 0 && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {trackedExercises.length}/5 tracked
            </span>
          )}
        </div>

        <div className="panel p-4">
          {trackedExercises.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {trackedExercises.map((name) => (
                <span
                  key={name}
                  className="flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-medium text-secondary-foreground"
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => removeTracked(name)}
                    className="leading-none text-muted-foreground transition hover:text-foreground"
                    aria-label={`Remove ${name}`}
                  >
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
                placeholder={
                  personalBests.length === 0
                    ? "Log exercises first to track progression"
                    : "Add an exercise to track…"
                }
                disabled={personalBests.length === 0}
                className="w-full rounded-lg border border-border bg-input px-3.5 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {trackOpen && filteredCandidates.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                  {filteredCandidates.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        addTracked(name);
                      }}
                      className="w-full px-4 py-2.5 text-left text-sm text-foreground hover:bg-secondary"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Maximum of 5 exercises reached. Remove one to add another.
            </p>
          )}

          {trackedExercises.length === 0 && personalBests.length > 0 && (
            <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
              Pick up to 5 exercises from your history to chart progression.
            </p>
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
                <div key={name} className="panel p-3.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[13px] font-semibold text-foreground">{name}</p>
                    {chartLabel && (
                      <p className="text-[11px] text-muted-foreground">{chartLabel}</p>
                    )}
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

    </section>
  );
}

// --- Shared sub-components ---

function FormField({
  label,
  error,
  children,
}: {
  label: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-foreground">{label}</span>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </label>
  );
}

function inputClass(hasError?: string) {
  return `w-full rounded-lg border bg-input px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground ${
    hasError
      ? "border-destructive focus:border-destructive"
      : "border-border focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
  }`;
}
