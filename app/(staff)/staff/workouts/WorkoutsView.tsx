"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  ClassCategoryRecord,
  ClassWorkoutTemplateRecord,
  ExerciseRecord,
} from "@/lib/db";

type TemplateRow = {
  key: string;
  exerciseId: string | null;
  name: string;
  weight: string;
  reps: string;
  sets: string;
  supersetGroup: string;
};

type FormValues = {
  name: string;
  categories: string[];
  notes: string;
  exercises: TemplateRow[];
};

function newRow(): TemplateRow {
  return { key: crypto.randomUUID(), exerciseId: null, name: "", weight: "", reps: "", sets: "", supersetGroup: "" };
}

function emptyForm(): FormValues {
  return { name: "", categories: [], notes: "", exercises: [newRow()] };
}

function formFromTemplate(template: ClassWorkoutTemplateRecord): FormValues {
  return {
    name: template.name,
    categories: template.categories,
    notes: template.notes ?? "",
    exercises:
      template.exercises.length === 0
        ? [newRow()]
        : template.exercises.map((e) => ({
            key: crypto.randomUUID(),
            exerciseId: e.exerciseId,
            name: e.name,
            weight: e.weight,
            reps: e.reps === null ? "" : String(e.reps),
            sets: e.sets === null ? "" : String(e.sets),
            supersetGroup: e.supersetGroup ?? "",
          })),
  };
}

// Groups rows sharing a non-empty superset label together, wherever they
// fall in the list — mirrors the member app's station (ST1/ST2) grouping so
// coaches see the same layout they're building for.
function groupRows(rows: TemplateRow[]): { key: string; label: string | null; rows: TemplateRow[] }[] {
  const groups: { key: string; label: string | null; rows: TemplateRow[] }[] = [];
  const labelIndex = new Map<string, number>();
  for (const row of rows) {
    const label = row.supersetGroup.trim() || null;
    if (label && labelIndex.has(label)) {
      groups[labelIndex.get(label)!].rows.push(row);
    } else if (label) {
      labelIndex.set(label, groups.length);
      groups.push({ key: `group-${label}`, label, rows: [row] });
    } else {
      groups.push({ key: row.key, label: null, rows: [row] });
    }
  }
  return groups;
}

function summarizeExercises(template: ClassWorkoutTemplateRecord): string {
  const grouped = groupRows(
    template.exercises.map((e) => ({
      key: e.name,
      exerciseId: e.exerciseId,
      name: e.name,
      weight: e.weight,
      reps: e.reps === null ? "" : String(e.reps),
      sets: e.sets === null ? "" : String(e.sets),
      supersetGroup: e.supersetGroup ?? "",
    }))
  );
  return grouped
    .map((g) => (g.rows.length > 1 ? `${g.label} (${g.rows.map((r) => r.name).join(" + ")})` : g.rows[0].name))
    .join(", ");
}

const inputCls =
  "w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15";

export function WorkoutsView({
  templates,
  categories,
  exercises,
}: {
  templates: ClassWorkoutTemplateRecord[];
  categories: ClassCategoryRecord[];
  exercises: ExerciseRecord[];
}) {
  const router = useRouter();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function startAdd() {
    setEditingId(null);
    setValues(emptyForm());
    setError(null);
    setFormOpen(true);
  }

  function startEdit(template: ClassWorkoutTemplateRecord) {
    setEditingId(template.id);
    setValues(formFromTemplate(template));
    setError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setError(null);
  }

  function updateRow(key: string, patch: Partial<TemplateRow>) {
    setValues((v) => ({ ...v, exercises: v.exercises.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  }

  function toggleCategory(slug: string) {
    setValues((v) => ({
      ...v,
      categories: v.categories.includes(slug) ? v.categories.filter((c) => c !== slug) : [...v.categories, slug],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/staff/workout-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          name: values.name,
          categories: values.categories,
          notes: values.notes,
          exercises: values.exercises
            .filter((r) => r.name.trim())
            .map((r) => ({
              exerciseId: r.exerciseId,
              name: r.name,
              weight: r.weight,
              reps: r.reps.trim() ? Number(r.reps) : null,
              sets: r.sets.trim() ? Number(r.sets) : null,
              supersetGroup: r.supersetGroup.trim() || null,
            })),
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.message ?? "Could not save the template.");
        return;
      }

      closeForm();
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleteError(null);
    setDeletingId(id);

    try {
      const res = await fetch("/api/staff/workout-templates/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setDeleteError(data?.message ?? "Could not delete the template.");
        return;
      }

      router.refresh();
    } catch {
      setDeleteError("Something went wrong. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  const groupedRows = groupRows(values.exercises);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label-caps">Staff</p>
          <h2 className="text-display mt-1 text-[28px] leading-tight">Workouts</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Build a library of class workout templates. Load one onto any upcoming class instead of
            building it from scratch — group exercises into stations (ST1, ST2, …) for the standard
            class format.
          </p>
        </div>
        {!formOpen ? (
          <button type="button" onClick={startAdd} className="btn-primary shrink-0 px-4 py-2">
            + New template
          </button>
        ) : null}
      </div>

      {deleteError ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {deleteError}
        </p>
      ) : null}

      {formOpen ? (
        <form onSubmit={handleSubmit} className="panel space-y-4 p-6">
          <h3 className="text-lg font-semibold">{editingId ? "Edit template" : "New template"}</h3>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
            <input
              type="text"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              placeholder="e.g. Full Body Strength A"
              className={inputCls}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Classes this can be added to</label>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCategory(c.slug)}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                    values.categories.includes(c.slug)
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border text-foreground hover:bg-accent"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Exercises <span className="font-normal">give two or more the same station label (e.g. ST1) to group them as a superset</span>
            </label>
            <div className="space-y-3">
              {groupedRows.map((group) =>
                group.rows.length > 1 ? (
                  <div key={group.key} className="rounded-xl border border-teal-600/40 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-teal-300">{group.label}</p>
                    <div className="space-y-3">
                      {group.rows.map((row, i) => (
                        <div key={row.key} className={i > 0 ? "border-t border-border/60 pt-3" : ""}>
                          <ExerciseRowFields row={row} onChange={(patch) => updateRow(row.key, patch)} onRemove={() => setValues((v) => ({ ...v, exercises: v.exercises.filter((r) => r.key !== row.key) }))} />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div key={group.key} className="well p-3">
                    <ExerciseRowFields row={group.rows[0]} onChange={(patch) => updateRow(group.rows[0].key, patch)} onRemove={() => setValues((v) => ({ ...v, exercises: v.exercises.filter((r) => r.key !== group.rows[0].key) }))} />
                  </div>
                )
              )}
            </div>

            <datalist id="library-exercises">
              {exercises.map((e) => (
                <option key={e.id} value={e.name} />
              ))}
            </datalist>

            <button
              type="button"
              onClick={() => setValues((v) => ({ ...v, exercises: [...v.exercises, newRow()] }))}
              className="mt-3 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
            >
              + Add exercise
            </button>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Notes (optional)</label>
            <textarea
              value={values.notes}
              onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
              placeholder="Warm-up, focus, scaling options…"
              className={`${inputCls} min-h-[64px] resize-y`}
            />
          </div>

          {error ? (
            <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          ) : null}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeForm} className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn-primary px-5 py-2 disabled:cursor-not-allowed disabled:opacity-60">
              {submitting ? "Saving…" : editingId ? "Save changes" : "Create template"}
            </button>
          </div>
        </form>
      ) : null}

      {templates.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          No templates yet. Create your first one above.
        </p>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="well flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t.name}</p>
                <p className="mt-0.5 flex flex-wrap gap-1.5">
                  {t.categories.map((slug) => (
                    <span key={slug} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      {categories.find((c) => c.slug === slug)?.name ?? slug}
                    </span>
                  ))}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{summarizeExercises(t)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => startEdit(t)} className="rounded-xl border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent">
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(t.id)}
                  disabled={deletingId === t.id}
                  className="rounded-xl border border-destructive/30 px-3 py-1 text-xs font-medium text-destructive transition hover:border-destructive/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deletingId === t.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExerciseRowFields({
  row,
  onChange,
  onRemove,
}: {
  row: TemplateRow;
  onChange: (patch: Partial<TemplateRow>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          list="library-exercises"
          value={row.name}
          onChange={(e) => onChange({ name: e.target.value, exerciseId: null })}
          placeholder="Exercise (e.g. Back Squat)"
          className={inputCls}
        />
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-lg border border-border px-2.5 py-2 text-xs text-muted-foreground transition hover:border-destructive/50 hover:text-destructive"
        >
          Remove
        </button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <input type="text" value={row.weight} onChange={(e) => onChange({ weight: e.target.value })} placeholder="Weight" aria-label="Default weight" className={inputCls} />
        <input type="number" min={0} value={row.reps} onChange={(e) => onChange({ reps: e.target.value })} placeholder="Reps" aria-label="Default reps" className={inputCls} />
        <input type="number" min={0} value={row.sets} onChange={(e) => onChange({ sets: e.target.value })} placeholder="Sets" aria-label="Default sets" className={inputCls} />
        <input type="text" value={row.supersetGroup} onChange={(e) => onChange({ supersetGroup: e.target.value })} placeholder="Station (e.g. ST1)" aria-label="Superset station label" className={inputCls} />
      </div>
    </div>
  );
}
