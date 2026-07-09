"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ExerciseRecord, ExerciseSection } from "@/lib/db";

const SECTIONS: { value: ExerciseSection; label: string }[] = [
  { value: "upper_push", label: "Upper Body — Push" },
  { value: "upper_pull", label: "Upper Body — Pull" },
  { value: "lower_push", label: "Lower Body — Push" },
  { value: "lower_pull", label: "Lower Body — Pull" },
];

function sectionLabel(section: ExerciseSection): string {
  return SECTIONS.find((s) => s.value === section)?.label ?? section;
}

type FormValues = { name: string; section: ExerciseSection };

function emptyForm(): FormValues {
  return { name: "", section: "upper_push" };
}

export function ExercisesView({ exercises }: { exercises: ExerciseRecord[] }) {
  const router = useRouter();

  const [addValues, setAddValues] = useState<FormValues>(emptyForm);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSubmitting, setAddSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<FormValues>(emptyForm);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddSubmitting(true);

    try {
      const res = await fetch("/api/staff/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: addValues.name, section: addValues.section }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setAddError(data?.message ?? "Could not add exercise.");
        return;
      }

      setAddValues(emptyForm());
      router.refresh();
    } catch {
      setAddError("Something went wrong. Please try again.");
    } finally {
      setAddSubmitting(false);
    }
  }

  function startEdit(exercise: ExerciseRecord) {
    setEditingId(exercise.id);
    setEditValues({ name: exercise.name, section: exercise.section });
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setEditError(null);
    setEditSubmitting(true);

    try {
      const res = await fetch("/api/staff/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, name: editValues.name, section: editValues.section }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setEditError(data?.message ?? "Could not update exercise.");
        return;
      }

      setEditingId(null);
      router.refresh();
    } catch {
      setEditError("Something went wrong. Please try again.");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleteError(null);

    try {
      const res = await fetch("/api/staff/exercises/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setDeleteError(data?.message ?? "Could not delete exercise.");
        return;
      }

      router.refresh();
    } catch {
      setDeleteError("Something went wrong. Please try again.");
    }
  }

  const bySection = SECTIONS.map(({ value, label }) => ({
    value,
    label,
    exercises: exercises.filter((e) => e.section === value),
  }));

  void sectionLabel; // used via SECTIONS lookup above

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="label-caps">Staff</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">Exercises</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Manage the exercise library. Members see these suggestions when logging workouts.
          Deleting an exercise removes it from future suggestions but does not affect historical
          workout records.
        </p>
      </div>

      {/* Add form */}
      <div className="rounded-3xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold">Add exercise</h3>
        <form onSubmit={handleAdd} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
            <input
              type="text"
              value={addValues.name}
              onChange={(e) => setAddValues((v) => ({ ...v, name: e.target.value }))}
              placeholder="e.g. Bench Press"
              className="w-full rounded-xl border border-border bg-input px-4 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
            />
          </div>
          <div className="w-full sm:w-60">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Section</label>
            <select
              value={addValues.section}
              onChange={(e) =>
                setAddValues((v) => ({ ...v, section: e.target.value as ExerciseSection }))
              }
              className="w-full rounded-xl border border-border bg-input px-4 py-2 text-sm text-foreground outline-none transition focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
            >
              {SECTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={addSubmitting}
            className="rounded-xl border border-teal-700/60 bg-gradient-to-b from-teal-500 to-teal-600 px-5 py-2 text-sm font-semibold text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_1px_2px_0_rgba(0,0,0,0.4)] transition-[background-color,transform] duration-150 hover:from-teal-400 hover:to-teal-500 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
          >
            {addSubmitting ? "Adding…" : "Add"}
          </button>
        </form>
        {addError ? (
          <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {addError}
          </p>
        ) : null}
      </div>

      {/* Per-section lists */}
      {deleteError ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {deleteError}
        </p>
      ) : null}

      {bySection.map(({ value, label, exercises: sectionExercises }) => (
        <div key={value} className="rounded-3xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold">{label}</h3>

          {sectionExercises.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No exercises in this section yet.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {sectionExercises.map((exercise) =>
                editingId === exercise.id ? (
                  <form
                    key={exercise.id}
                    onSubmit={handleEdit}
                    className="flex flex-col gap-2 rounded-2xl border border-primary/40 bg-background p-3 sm:flex-row sm:items-end"
                  >
                    <div className="flex-1">
                      <input
                        type="text"
                        value={editValues.name}
                        onChange={(e) =>
                          setEditValues((v) => ({ ...v, name: e.target.value }))
                        }
                        className="w-full rounded-xl border border-border bg-input px-3 py-1.5 text-sm text-foreground outline-none transition focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
                        autoFocus
                      />
                    </div>
                    <div className="w-full sm:w-56">
                      <select
                        value={editValues.section}
                        onChange={(e) =>
                          setEditValues((v) => ({
                            ...v,
                            section: e.target.value as ExerciseSection,
                          }))
                        }
                        className="w-full rounded-xl border border-border bg-input px-3 py-1.5 text-sm text-foreground outline-none transition focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
                      >
                        {SECTIONS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={editSubmitting}
                        className="rounded-xl border border-teal-700/60 bg-gradient-to-b from-teal-500 to-teal-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_1px_2px_0_rgba(0,0,0,0.4)] transition-[background-color,transform] duration-150 hover:from-teal-400 hover:to-teal-500 active:translate-y-px disabled:opacity-60"
                      >
                        {editSubmitting ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
                      >
                        Cancel
                      </button>
                    </div>
                    {editError ? (
                      <p className="w-full text-xs text-destructive">{editError}</p>
                    ) : null}
                  </form>
                ) : (
                  <div
                    key={exercise.id}
                    className="flex items-center justify-between well px-4 py-3"
                  >
                    <p className="text-sm">{exercise.name}</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(exercise)}
                        className="rounded-xl border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(exercise.id)}
                        className="rounded-xl border border-destructive/30 px-3 py-1 text-xs font-medium text-destructive transition hover:border-destructive/60"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      ))}

      {exercises.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          No exercises yet. Add your first exercise above.
        </p>
      ) : null}
    </div>
  );
}
