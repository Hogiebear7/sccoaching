"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ClassWorkoutRecord, ExerciseRecord, WorkoutExerciseEntry } from "@/lib/db";
import { formatFriendlyClassDate } from "@/lib/dates";

type TemplateRow = {
  key: string;
  exerciseId: string | null;
  name: string;
  weight: string;
  reps: string;
  sets: string;
};

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
  }));
}

function newTemplateRow(): TemplateRow {
  return { key: crypto.randomUUID(), exerciseId: null, name: "", weight: "", reps: "", sets: "" };
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
}: {
  classId: string;
  classTitle: string;
  classDate: string;
  startTime: string;
  existingWorkout: ClassWorkoutRecord | null;
  checkedIn: CheckedInMember[];
  libraryExercises: ExerciseRecord[];
}) {
  const router = useRouter();
  const [template, setTemplate] = useState<TemplateRow[]>(() =>
    rowsFromEntries(existingWorkout?.exercises ?? null)
  );
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
          {formatFriendlyClassDate(classDate)} · {startTime}. Record what the class did, then
          adjust the numbers per checked-in member — results sync straight into each
          member&apos;s workout history. Members can correct their own numbers until the end of
          today; after that only this screen changes them.
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
          The shared plan — default weight/reps/sets prefill each member&apos;s row.
        </p>

        <div className="mt-4 space-y-3">
          {template.map((row) => (
            <div key={row.key} className="well space-y-2 p-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  list="library-exercises"
                  value={row.name}
                  onChange={(e) => updateTemplate(row.key, { name: e.target.value, exerciseId: null })}
                  placeholder="Exercise (e.g. Back Squat)"
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={() => setTemplate((prev) => prev.filter((r) => r.key !== row.key))}
                  className="shrink-0 rounded-lg border border-border px-2.5 py-2 text-xs text-muted-foreground transition hover:border-destructive/50 hover:text-destructive"
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input type="text" value={row.weight} onChange={(e) => updateTemplate(row.key, { weight: e.target.value })} placeholder="Weight" aria-label="Default weight" className={inputCls} />
                <input type="number" min={0} value={row.reps} onChange={(e) => updateTemplate(row.key, { reps: e.target.value })} placeholder="Reps" aria-label="Default reps" className={inputCls} />
                <input type="number" min={0} value={row.sets} onChange={(e) => updateTemplate(row.key, { sets: e.target.value })} placeholder="Sets" aria-label="Default sets" className={inputCls} />
              </div>
            </div>
          ))}
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
