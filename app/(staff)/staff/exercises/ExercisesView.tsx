"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ExerciseRecord, ExerciseSection } from "@/lib/db";

const SECTIONS: { value: ExerciseSection; label: string }[] = [
  { value: "upper_push", label: "Upper Body — Push" },
  { value: "upper_pull", label: "Upper Body — Pull" },
  { value: "lower_push", label: "Lower Body — Push" },
  { value: "lower_pull", label: "Lower Body — Pull" },
  { value: "core", label: "Core" },
  { value: "cardio", label: "Cardio" },
];

function sectionLabel(section: ExerciseSection): string {
  return SECTIONS.find((s) => s.value === section)?.label ?? section;
}

type FormValues = { name: string; section: ExerciseSection; description: string; cues: string };

function emptyForm(): FormValues {
  return { name: "", section: "upper_push", description: "", cues: "" };
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

  // Sections holding exercises start open; empty ones start collapsed.
  const [openSections, setOpenSections] = useState<Set<ExerciseSection>>(
    () => new Set(exercises.map((e) => e.section))
  );
  const [drafting, setDrafting] = useState<"add" | "edit" | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  function toggleSection(section: ExerciseSection) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  // Fills ONLY empty fields with an AI draft — existing text is never
  // overwritten; staff review and edit before saving.
  async function handleDraft(
    which: "add" | "edit",
    values: FormValues,
    setValues: (updater: (v: FormValues) => FormValues) => void
  ) {
    if (!values.name.trim()) {
      setDraftError("Type the exercise name first.");
      return;
    }
    if (values.description.trim() && values.cues.trim()) {
      setDraftError("Both fields already have content — clear one to redraft it.");
      return;
    }
    setDraftError(null);
    setDrafting(which);
    try {
      const res = await fetch("/api/staff/exercises/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: values.name, section: values.section }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setDraftError(data?.message ?? "Could not draft content.");
        return;
      }
      setValues((v) => ({
        ...v,
        description: v.description.trim() ? v.description : (data.description ?? ""),
        cues: v.cues.trim() ? v.cues : (data.cues ?? ""),
      }));
    } catch {
      setDraftError("Something went wrong. Please try again.");
    } finally {
      setDrafting(null);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddSubmitting(true);

    try {
      const res = await fetch("/api/staff/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addValues.name,
          section: addValues.section,
          description: addValues.description,
          cues: addValues.cues,
        }),
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
    setEditValues({
      name: exercise.name,
      section: exercise.section,
      description: exercise.description ?? "",
      cues: exercise.cues ?? "",
    });
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
        body: JSON.stringify({
          id: editingId,
          name: editValues.name,
          section: editValues.section,
          description: editValues.description,
          cues: editValues.cues,
        }),
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
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Add exercise</h3>
        <form onSubmit={handleAdd} className="mt-4 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Description <span className="font-normal">optional — what it is / what it trains</span>
              </label>
              <textarea
                value={addValues.description}
                onChange={(e) => setAddValues((v) => ({ ...v, description: e.target.value }))}
                maxLength={1000}
                placeholder="e.g. A hip-hinge pattern loading the posterior chain…"
                className="min-h-[72px] w-full resize-y rounded-xl border border-border bg-input px-4 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Coaching cues <span className="font-normal">optional — one per line</span>
              </label>
              <textarea
                value={addValues.cues}
                onChange={(e) => setAddValues((v) => ({ ...v, cues: e.target.value }))}
                maxLength={600}
                placeholder={"Brace before you pull\nPush the floor away"}
                className="min-h-[72px] w-full resize-y rounded-xl border border-border bg-input px-4 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {draftError ? (
              <p className="mr-auto text-xs text-destructive">{draftError}</p>
            ) : null}
            <button
              type="button"
              onClick={() => handleDraft("add", addValues, setAddValues)}
              disabled={drafting !== null}
              className="rounded-xl border border-blue-400/30 px-4 py-2 text-sm font-medium text-blue-300 transition hover:border-blue-400/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {drafting === "add" ? "Drafting…" : "Draft with AI"}
            </button>
            <button
              type="submit"
              disabled={addSubmitting}
              className="btn-primary px-5 py-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {addSubmitting ? "Adding…" : "Add"}
            </button>
          </div>
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
        <div key={value} className="panel p-6">
          <button
            type="button"
            aria-expanded={openSections.has(value)}
            onClick={() => toggleSection(value)}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span className="flex items-baseline gap-2">
              <span className="text-lg font-semibold">{label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {sectionExercises.length}
              </span>
            </span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 ${
                openSections.has(value) ? "rotate-180" : ""
              }`}
            >
              <path d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {!openSections.has(value) ? null : sectionExercises.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No exercises in this section yet.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {sectionExercises.map((exercise) =>
                editingId === exercise.id ? (
                  <form
                    key={exercise.id}
                    onSubmit={handleEdit}
                    className="flex flex-col gap-2 rounded-2xl border border-primary/40 bg-background p-3 sm:flex-row sm:flex-wrap sm:items-end"
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
                    <div className="w-full space-y-2 sm:order-last sm:basis-full">
                      <textarea
                        value={editValues.description}
                        onChange={(e) => setEditValues((v) => ({ ...v, description: e.target.value }))}
                        maxLength={1000}
                        placeholder="Description (optional)"
                        aria-label="Exercise description"
                        className="min-h-[56px] w-full resize-y rounded-xl border border-border bg-input px-3 py-1.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
                      />
                      <textarea
                        value={editValues.cues}
                        onChange={(e) => setEditValues((v) => ({ ...v, cues: e.target.value }))}
                        maxLength={600}
                        placeholder="Coaching cues (optional, one per line)"
                        aria-label="Coaching cues"
                        className="min-h-[56px] w-full resize-y rounded-xl border border-border bg-input px-3 py-1.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleDraft("edit", editValues, setEditValues)}
                        disabled={drafting !== null}
                        className="rounded-xl border border-blue-400/30 px-3 py-1.5 text-xs font-medium text-blue-300 transition hover:border-blue-400/60 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {drafting === "edit" ? "Drafting…" : "Draft with AI"}
                      </button>
                      <button
                        type="submit"
                        disabled={editSubmitting}
                        className="btn-primary px-3 py-1.5 text-xs disabled:opacity-60"
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
                    <div className="min-w-0">
                      <p className="text-sm">{exercise.name}</p>
                      {exercise.description || exercise.cues ? (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {exercise.description ?? exercise.cues}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs text-muted-foreground/50">No guide yet</p>
                      )}
                    </div>
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
