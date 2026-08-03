"use client";

import { useState } from "react";

import type { WorkoutSessionRecord } from "@/lib/db";

// Same-day correction for a class-synced session: weight/reps/sets/RPE per
// exercise plus notes. The API enforces the day window; this UI only shows
// for sessions dated today. Shared by both view variants' history section —
// there is only one editing flow.
export function ClassSessionEditor({
  session,
  onDone,
  onCancel,
}: {
  session: WorkoutSessionRecord;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState(() =>
    session.exercises.map((ex) => ({
      key: crypto.randomUUID(),
      name: ex.name,
      weight: ex.weight ?? "",
      reps: ex.reps === null ? "" : String(ex.reps),
      sets: ex.sets === null ? "" : String(ex.sets),
      rpe: ex.rpe == null ? "" : String(ex.rpe),
    }))
  );
  const [notes, setNotes] = useState(session.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const inputCls =
    "w-full rounded-lg border border-border bg-input px-2.5 py-1.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15";

  async function handleSave() {
    setError(null);
    setIsSaving(true);
    try {
      const res = await fetch("/api/workouts/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          notes,
          exercises: rows.map((r) => ({
            name: r.name,
            weight: r.weight,
            reps: r.reps.trim() ? Number(r.reps) : null,
            sets: r.sets.trim() ? Number(r.sets) : null,
            rpe: r.rpe.trim() ? Number(r.rpe) : null,
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "Could not save your correction.");
        return;
      }
      onDone();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border/60 bg-white/[0.02] p-3">
      <p className="text-xs text-muted-foreground">
        Correct your numbers from this class — editable until the end of today.
      </p>
      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      ) : null}
      {rows.map((row) => (
        <div key={row.key}>
          <p className="mb-1 text-xs font-medium text-foreground">{row.name}</p>
          <div className="grid grid-cols-4 gap-2">
            <input type="text" value={row.weight} onChange={(e) => setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, weight: e.target.value } : r)))} placeholder="Weight" aria-label={`${row.name} weight`} className={inputCls} />
            <input type="number" min={0} value={row.reps} onChange={(e) => setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, reps: e.target.value } : r)))} placeholder="Reps" aria-label={`${row.name} reps`} className={inputCls} />
            <input type="number" min={0} value={row.sets} onChange={(e) => setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, sets: e.target.value } : r)))} placeholder="Sets" aria-label={`${row.name} sets`} className={inputCls} />
            <input type="number" min={1} max={10} step={0.5} value={row.rpe} onChange={(e) => setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, rpe: e.target.value } : r)))} placeholder="RPE" aria-label={`${row.name} RPE`} className={inputCls} />
          </div>
        </div>
      ))}
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        aria-label="Session notes"
        className={inputCls}
      />
      <div className="flex gap-2">
        <button type="button" onClick={handleSave} disabled={isSaving} className="btn-primary px-3.5 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60">
          {isSaving ? "Saving…" : "Save correction"}
        </button>
        <button type="button" onClick={onCancel} disabled={isSaving} className="rounded-xl border border-border px-3.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent">
          Cancel
        </button>
      </div>
    </div>
  );
}
