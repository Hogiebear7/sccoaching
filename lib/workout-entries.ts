import type { WorkoutExerciseEntry } from "./db";

// Shared parser for exercise rows arriving from any client (member logging,
// member same-day edits, staff class recording). Rows with an empty name are
// dropped; exerciseId is stored as-is so historical snapshots stay readable
// if the library item is later renamed or deleted.
export function parseExerciseEntries(exercises: unknown): WorkoutExerciseEntry[] {
  if (!Array.isArray(exercises)) return [];

  return exercises.flatMap((entry) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name.trim() : "";
    if (!name) return [];

    const repsRaw = typeof e.reps === "number" ? e.reps : null;
    const setsRaw = typeof e.sets === "number" ? e.sets : null;
    const rpeRaw = typeof e.rpe === "number" ? e.rpe : null;

    // Per-set rows: keep only sets carrying at least one value; cap length
    // defensively so a buggy client can't balloon a record.
    const setDetails = Array.isArray(e.setDetails)
      ? e.setDetails
          .slice(0, 20)
          .map((raw) => {
            const s = (raw ?? {}) as Record<string, unknown>;
            const reps = typeof s.reps === "number" ? s.reps : null;
            return {
              weight: typeof s.weight === "string" && s.weight.trim() ? s.weight.trim() : null,
              reps: reps !== null && Number.isFinite(reps) && reps >= 0 ? Math.floor(reps) : null,
            };
          })
          .filter((s) => s.weight !== null || s.reps !== null)
      : [];

    return [
      {
        exerciseId: typeof e.exerciseId === "string" && e.exerciseId ? e.exerciseId : null,
        name,
        weight: typeof e.weight === "string" && e.weight.trim() ? e.weight.trim() : null,
        reps: repsRaw !== null && Number.isFinite(repsRaw) && repsRaw >= 0 ? Math.floor(repsRaw) : null,
        sets: setsRaw !== null && Number.isFinite(setsRaw) && setsRaw >= 0 ? Math.floor(setsRaw) : null,
        rpe:
          rpeRaw !== null && Number.isFinite(rpeRaw) && rpeRaw >= 1 && rpeRaw <= 10
            ? Math.round(rpeRaw * 2) / 2
            : null,
        setDetails: setDetails.length > 0 ? setDetails : null,
        notes: typeof e.notes === "string" && e.notes.trim() ? e.notes.trim() : null,
      } satisfies WorkoutExerciseEntry,
    ];
  });
}

// Compact display for an exercise entry: per-set detail when present
// ("60kg×8, 65kg×6"), otherwise the shared sets×reps @ weight form.
export function formatExerciseLoad(ex: WorkoutExerciseEntry): string {
  if (ex.setDetails && ex.setDetails.length > 0) {
    return ex.setDetails
      .map((s) => {
        if (s.weight && s.reps !== null) return `${s.weight}×${s.reps}`;
        if (s.weight) return `${s.weight}`;
        if (s.reps !== null) return `×${s.reps}`;
        return "—";
      })
      .join(", ");
  }
  const parts: string[] = [];
  if (ex.sets !== null && ex.reps !== null) parts.push(`${ex.sets}×${ex.reps}`);
  else if (ex.sets !== null) parts.push(`${ex.sets} sets`);
  else if (ex.reps !== null) parts.push(`${ex.reps} reps`);
  if (ex.weight) parts.push(`@ ${ex.weight}`);
  if (ex.rpe != null) parts.push(`RPE ${ex.rpe}`);
  return parts.join(" ");
}
