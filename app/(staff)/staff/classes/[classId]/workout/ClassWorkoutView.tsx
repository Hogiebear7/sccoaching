"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  ClassWorkoutRecord,
  ClassWorkoutTemplateRecord,
  ExerciseRecord,
  WorkoutExerciseEntry,
} from "@/lib/db";
import { formatFriendlyClassDate } from "@/lib/dates";

type TemplateRow = {
  key: string;
  exerciseId: string | null;
  name: string;
  weight: string;
  reps: string;
  sets: string;
  supersetGroup: string;
};

// Groups rows sharing a non-empty station label together, wherever they fall
// in the list — matches the member app's ST1/ST2 station grouping.
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

type MemberRow = {
  key: string;
  name: string;
  weight: string;
  reps: string;
  sets: string;
  rpe: string;
};

type CheckedInMember = {
  userId: string;
  name: string;
  existingExercises: WorkoutExerciseEntry[] | null;
  existingNotes: string | null;
};

function rowsFromEntries(entries: WorkoutExerciseEntry[] | null): TemplateRow[] {
  if (!entries || entries.length === 0) return [newTemplateRow()];
  return entries.map((e) => ({
    key: crypto.randomUUID(),
    exerciseId: e.exerciseId,
    name: e.name,
    weight: e.weight ?? "",
    reps: e.reps === null ? "" : String(e.reps),
    sets: e.sets === null ? "" : String(e.sets),
    supersetGroup: e.supersetGroup ?? "",
  }));
}

function rowsFromLibraryTemplate(template: ClassWorkoutTemplateRecord): TemplateRow[] {
  if (template.exercises.length === 0) return [newTemplateRow()];
  return template.exercises.map((e) => ({
    key: crypto.randomUUID(),
    exerciseId: e.exerciseId,
    name: e.name,
    weight: e.weight,
    reps: e.reps === null ? "" : String(e.reps),
    sets: e.sets === null ? "" : String(e.sets),
    supersetGroup: e.supersetGroup ?? "",
  }));
}

function newTemplateRow(): TemplateRow {
  return { key: crypto.randomUUID(), exerciseId: null, name: "", weight: "", reps: "", sets: "", supersetGroup: "" };
}

// Member rows mirror the template's exercises by index; staff only adjust
// the numbers per member.
function memberRowsFromTemplate(
  template: TemplateRow[],
  existing: WorkoutExerciseEntry[] | null
): MemberRow[] {
  return template
    .filter((t) => t.name.trim())
    .map((t) => {
      const prior = existing?.find((e) => e.name.toLowerCase() === t.name.trim().toLowerCase());
      return {
        key: crypto.randomUUID(),
        name: t.name.trim(),
        weight: prior?.weight ?? t.weight,
        reps: prior?.reps != null ? String(prior.reps) : t.reps,
        sets: prior?.sets != null ? String(prior.sets) : t.sets,
        rpe: prior?.rpe != null ? String(prior.rpe) : "",
      };
    });
}

export function ClassWorkoutView({
  classId,
  classTitle,
  classDate,
  startTime,
  existingWorkout,
  checkedIn,
  libraryExercises,
  templates,
}: {
  classId: string;
  classTitle: string;
  classDate: string;
  startTime: string;
  existingWorkout: ClassWorkoutRecord | null;
  checkedIn: CheckedInMember[];
  libraryExercises: ExerciseRecord[];
  templates: ClassWorkoutTemplateRecord[];
}) {
  const router = useRouter();
  const [template, setTemplate] = useState<TemplateRow[]>(() =>
    rowsFromEntries(existingWorkout?.exercises ?? null)
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [workoutNotes, setWorkoutNotes] = useState(existingWorkout?.notes ?? "");
  const [memberRows, setMemberRows] = useState<Record<string, MemberRow[]>>({});
  const [memberNotes, setMemberNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(checkedIn.map((m) => [m.userId, m.existingNotes ?? ""]))
  );
  const [openMember, setOpenMember] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function updateTemplate(key: string, patch: Partial<TemplateRow>) {
    setTemplate((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setMessage(null);
  }

  function loadTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    const found = templates.find((t) => t.id === templateId);
    if (!found) return;
    setTemplate(rowsFromLibraryTemplate(found));
    setMessage(null);
  }

  function rowsFor(member: CheckedInMember): MemberRow[] {
    return memberRows[member.userId] ?? memberRowsFromTemplate(template, member.existingExercises);
  }

  function updateMemberRow(userId: string, key: string, patch: Partial<MemberRow>) {
    setMemberRows((prev) => {
      const member = checkedIn.find((m) => m.userId === userId)!;
      const rows = prev[userId] ?? memberRowsFromTemplate(template, member.existingExercises);
      return { ...prev, [userId]: rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) };
    });
    setMessage(null);
  }

  async function handleSave() {
    setError(null);
    setMessage(null);
    setIsSaving(true);

    try {
      const results = checkedIn.map((member) => ({
        userId: member.userId,
        notes: memberNotes[member.userId] ?? "",
        exercises: rowsFor(member).map((r) => ({
          name: r.name,
          weight: r.weight,
          reps: r.reps.trim() ? Number(r.reps) : null,
          sets: r.sets.trim() ? Number(r.sets) : null,
          rpe: r.rpe.trim() ? Number(r.rpe) : null,
        })),
      }));

      const res = await fetch(`/api/staff/classes/${classId}/workout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: workoutNotes,
          exercises: template.map((r) => ({
            exerciseId: r.exerciseId,
            name: r.name,
            weight: r.weight,
            reps: r.reps.trim() ? Number(r.reps) : null,
            sets: r.sets.trim() ? Number(r.sets) : null,
            supersetGroup: r.supersetGroup.trim() || null,
          })),
          results,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.message ?? "Could not save the class workout.");
        return;
      }

      setMessage(data?.message ?? "Class workout saved.");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15";

  return (
    <section className="space-y-6">
      <Link href="/staff/classes" className="text-sm text-gold transition hover:text-gold/80">
        ← Back to classes
      </Link>

      <div>
        <p className="label-caps">Class workout</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">{classTitle}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {formatFriendlyClassDate(classDate)} · {startTime}. Save the workout below and it lands
          in every booked member&apos;s Workouts tab right away — no need to wait for the class.
          Once someone&apos;s checked in you can also enter their exact numbers here, which sync
          straight into their history. Members can fill in or correct their own weights until the
          end of today; after that only this screen changes them.
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>
      ) : null}
      {message ? (
        <p className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">{message}</p>
      ) : null}

      {/* Template */}
      <div className="panel p-5">
        <h3 className="text-base font-semibold">Workout</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          The shared plan — default weight/reps/sets prefill each member&apos;s row. Give two or
          more exercises the same station label (e.g. ST1) to group them as a superset.
        </p>

        {templates.length > 0 ? (
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Load from template</label>
            <select
              value={selectedTemplateId}
              onChange={(e) => loadTemplate(e.target.value)}
              className={inputCls}
            >
              <option value="">Choose a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          {groupRows(template).map((group) =>
            group.rows.length > 1 ? (
              <div key={group.key} className="rounded-xl border border-teal-600/40 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-teal-300">{group.label}</p>
                <div className="space-y-3">
                  {group.rows.map((row, i) => (
                    <div key={row.key} className={i > 0 ? "border-t border-border/60 pt-3" : ""}>
                      <TemplateRowFields row={row} inputCls={inputCls} onChange={(patch) => updateTemplate(row.key, patch)} onRemove={() => setTemplate((prev) => prev.filter((r) => r.key !== row.key))} />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div key={group.key} className="well space-y-2 p-3">
                <TemplateRowFields row={group.rows[0]} inputCls={inputCls} onChange={(patch) => updateTemplate(group.rows[0].key, patch)} onRemove={() => setTemplate((prev) => prev.filter((r) => r.key !== group.rows[0].key))} />
              </div>
            )
          )}
        </div>

        <datalist id="library-exercises">
          {libraryExercises.map((e) => (
            <option key={e.id} value={e.name} />
          ))}
        </datalist>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTemplate((prev) => [...prev, newTemplateRow()])}
            className="rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
          >
            + Add exercise
          </button>
        </div>

        <textarea
          value={workoutNotes}
          onChange={(e) => setWorkoutNotes(e.target.value)}
          placeholder="Session notes (optional) — warm-up, focus, scaling options"
          className={`${inputCls} mt-3 min-h-[64px] resize-y`}
        />
      </div>

      {/* Checked-in members */}
      <div className="panel p-5">
        <h3 className="text-base font-semibold">Checked-in members</h3>
        {checkedIn.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nobody is checked in yet. Mark attendance on the Classes page first — results only
            sync for checked-in members.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {checkedIn.map((member) => {
              const open = openMember === member.userId;
              const rows = rowsFor(member);
              return (
                <div key={member.userId} className="well p-3">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenMember(open ? null : member.userId)}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <span className="text-sm font-medium">{member.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {member.existingExercises ? "Synced — edit" : open ? "Close" : "Enter results"}
                    </span>
                  </button>

                  {open ? (
                    <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
                      {rows.map((row) => (
                        <div key={row.key}>
                          <p className="mb-1.5 text-xs font-medium text-foreground">{row.name}</p>
                          <div className="grid grid-cols-4 gap-2">
                            <input type="text" value={row.weight} onChange={(e) => updateMemberRow(member.userId, row.key, { weight: e.target.value })} placeholder="Weight" aria-label={`${row.name} weight for ${member.name}`} className={inputCls} />
                            <input type="number" min={0} value={row.reps} onChange={(e) => updateMemberRow(member.userId, row.key, { reps: e.target.value })} placeholder="Reps" aria-label={`${row.name} reps for ${member.name}`} className={inputCls} />
                            <input type="number" min={0} value={row.sets} onChange={(e) => updateMemberRow(member.userId, row.key, { sets: e.target.value })} placeholder="Sets" aria-label={`${row.name} sets for ${member.name}`} className={inputCls} />
                            <input type="number" min={1} max={10} step={0.5} value={row.rpe} onChange={(e) => updateMemberRow(member.userId, row.key, { rpe: e.target.value })} placeholder="RPE" aria-label={`${row.name} RPE for ${member.name}`} className={inputCls} />
                          </div>
                        </div>
                      ))}
                      <input
                        type="text"
                        value={memberNotes[member.userId] ?? ""}
                        onChange={(e) => {
                          setMemberNotes((prev) => ({ ...prev, [member.userId]: e.target.value }));
                          setMessage(null);
                        }}
                        placeholder="Notes for this member (optional)"
                        aria-label={`Notes for ${member.name}`}
                        className={inputCls}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="btn-primary px-5 py-2.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Saving…" : "Save & sync to members"}
        </button>
      </div>
    </section>
  );
}

function TemplateRowFields({
  row,
  inputCls,
  onChange,
  onRemove,
}: {
  row: TemplateRow;
  inputCls: string;
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
