import type { WorkoutExerciseEntry, WorkoutSetType } from "./db";

const SET_TYPES: WorkoutSetType[] = ["standard", "warmup", "dropset", "myoset", "failure", "partial"];

function parseSetType(value: unknown): WorkoutSetType | null {
  return typeof value === "string" && SET_TYPES.includes(value as WorkoutSetType) ? (value as WorkoutSetType) : null;
}

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
    const rirRaw = typeof e.rir === "number" ? e.rir : null;

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
              setType: parseSetType(s.setType),
            };
          })
          .filter((s) => s.weight !== null || s.reps !== null || s.setType !== null)
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
        rir:
          rirRaw !== null && Number.isFinite(rirRaw) && rirRaw >= 0 && rirRaw <= 5
            ? Math.round(rirRaw)
            : null,
        setDetails: setDetails.length > 0 ? setDetails : null,
        setType: parseSetType(e.setType),
        supersetGroup: typeof e.supersetGroup === "string" && e.supersetGroup.trim() ? e.supersetGroup.trim() : null,
        perSide: e.perSide === true,
        notes: typeof e.notes === "string" && e.notes.trim() ? e.notes.trim() : null,
      } satisfies WorkoutExerciseEntry,
    ];
  });
}

export const SET_TYPE_LABEL: Record<WorkoutSetType, string> = {
  standard: "",
  warmup: "warm-up",
  dropset: "dropset",
  myoset: "myoset",
  failure: "failure",
  partial: "partials",
};

// Compact display for an exercise entry: per-set detail when present
// ("60kg×8, 65kg×6 (dropset)"), otherwise the shared sets×reps @ weight form.
export function formatExerciseLoad(ex: WorkoutExerciseEntry): string {
  const perSideSuffix = ex.perSide ? "/side" : "";
  if (ex.setDetails && ex.setDetails.length > 0) {
    return ex.setDetails
      .map((s) => {
        const load =
          s.weight && s.reps !== null
            ? `${s.weight}×${s.reps}${perSideSuffix}`
            : s.weight
              ? `${s.weight}`
              : s.reps !== null
                ? `×${s.reps}${perSideSuffix}`
                : "—";
        const typeLabel = s.setType ? SET_TYPE_LABEL[s.setType] : "";
        return typeLabel ? `${load} (${typeLabel})` : load;
      })
      .join(", ");
  }
  const parts: string[] = [];
  if (ex.sets !== null && ex.reps !== null) parts.push(`${ex.sets}×${ex.reps}${perSideSuffix}`);
  else if (ex.sets !== null) parts.push(`${ex.sets} sets`);
  else if (ex.reps !== null) parts.push(`${ex.reps} reps${perSideSuffix}`);
  if (ex.weight) parts.push(`@ ${ex.weight}`);
  if (ex.rpe != null) parts.push(`RPE ${ex.rpe}`);
  if (ex.rir != null) parts.push(`RIR ${ex.rir}`);
  if (ex.setType && SET_TYPE_LABEL[ex.setType]) parts.push(`(${SET_TYPE_LABEL[ex.setType]})`);
  return parts.join(" ");
}
