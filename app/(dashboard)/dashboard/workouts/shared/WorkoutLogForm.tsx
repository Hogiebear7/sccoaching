"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

import type { ExerciseRecord } from "@/lib/db";
import { ExerciseAutocomplete } from "./ExerciseAutocomplete";
import { livePace, parseDuration, todayDateString } from "./formatters";

// --- Types ---

type WorkoutFormValues = {
  title: string;
  date: string;
  durationMins: string;
  notes: string;
};

type FormErrors = Partial<Record<keyof WorkoutFormValues, string>>;

type SetRow = { key: string; weight: string; reps: string };

type ExerciseRow = {
  key: string;
  exerciseId: string | null;
  name: string;
  weight: string;
  reps: string;
  sets: string;
  notes: string;
  /** Per-set weight/reps rows; empty = one shared value for every set. */
  setRows: SetRow[];
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

function emptyFormValues(): WorkoutFormValues {
  return { title: "", date: todayDateString(), durationMins: "", notes: "" };
}

function newRow(): ExerciseRow {
  return { key: crypto.randomUUID(), exerciseId: null, name: "", weight: "", reps: "", sets: "", notes: "", setRows: [] };
}

function newRunRow(): RunRow {
  return { key: crypto.randomUUID(), distance: "", distanceUnit: "km", duration: "", reps: "", sets: "", notes: "" };
}

// The one workout-logging implementation, rendered identically by both view
// variants. Variants only vary the surrounding surface classes via
// `containerClassName` — the state, validation, and submit flow (POST
// /api/workouts/create) are never duplicated.
export function WorkoutLogForm({
  exercises,
  containerClassName = "surface-card p-5",
}: {
  exercises: ExerciseRecord[];
  containerClassName?: string;
}) {
  const router = useRouter();

  const [values, setValues] = useState<WorkoutFormValues>(() => emptyFormValues());
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [exerciseRows, setExerciseRows] = useState<ExerciseRow[]>([]);
  const [runRows, setRunRows] = useState<RunRow[]>([]);

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
        setDetails: row.setRows
          .filter((sr) => sr.weight.trim() || sr.reps.trim())
          .map((sr) => ({
            weight: sr.weight.trim() || null,
            reps: sr.reps.trim() ? parseInt(sr.reps, 10) : null,
          })),
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
    <form onSubmit={handleSubmit} className={containerClassName}>
      <p className="mb-4 label-caps">Log a workout</p>

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
                        className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
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
                        className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
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
                        className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
                      />
                    </div>
                  </div>

                  {/* Per-set detail — offered once sets ≥ 2; the shared
                      weight/reps become each set's prefill. */}
                  {Number(row.sets) >= 2 && row.setRows.length === 0 ? (
                    <button
                      type="button"
                      onClick={() =>
                        updateRow(row.key, {
                          setRows: Array.from({ length: Math.min(Number(row.sets), 12) }, () => ({
                            key: crypto.randomUUID(),
                            weight: row.weight,
                            reps: row.reps,
                          })),
                        })
                      }
                      className="text-xs font-medium text-primary transition hover:text-[var(--primary-hover)]"
                    >
                      Different weight/reps per set →
                    </button>
                  ) : null}

                  {row.setRows.length > 0 ? (
                    <div className="space-y-2 rounded-lg border border-border/60 bg-white/[0.02] p-3">
                      {row.setRows.map((set, setIdx) => (
                        <div key={set.key} className="grid grid-cols-[3rem_1fr_1fr] items-center gap-2">
                          <span className="text-xs text-muted-foreground">Set {setIdx + 1}</span>
                          <input
                            type="text"
                            value={set.weight}
                            onChange={(e) =>
                              updateRow(row.key, {
                                setRows: row.setRows.map((sr) =>
                                  sr.key === set.key ? { ...sr, weight: e.target.value } : sr
                                ),
                              })
                            }
                            placeholder="Weight"
                            aria-label={`Set ${setIdx + 1} weight`}
                            className="w-full rounded-lg border border-border bg-input px-3 py-1.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
                          />
                          <input
                            type="number"
                            min={0}
                            value={set.reps}
                            onChange={(e) =>
                              updateRow(row.key, {
                                setRows: row.setRows.map((sr) =>
                                  sr.key === set.key ? { ...sr, reps: e.target.value } : sr
                                ),
                              })
                            }
                            placeholder="Reps"
                            aria-label={`Set ${setIdx + 1} reps`}
                            className="w-full rounded-lg border border-border bg-input px-3 py-1.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => updateRow(row.key, { setRows: [] })}
                        className="text-xs text-muted-foreground transition hover:text-foreground"
                      >
                        Use one value for all sets
                      </button>
                    </div>
                  ) : null}

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
                      className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
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
                          className="w-full min-w-0 rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
                        />
                        <select
                          value={row.distanceUnit}
                          onChange={(e) =>
                            updateRunRow(row.key, { distanceUnit: e.target.value as "km" | "m" })
                          }
                          aria-label="Distance unit"
                          className="w-16 shrink-0 rounded-lg border border-border bg-input px-2 py-2 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
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
                        className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
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
                        className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
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
                        className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
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
                      className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
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
      : "border-border focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
  }`;
}
