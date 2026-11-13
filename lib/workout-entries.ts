import type { WorkoutExerciseEntry, WorkoutRunEntry, WorkoutSetType } from "./db";

/** A place in the workout (0, 1, 2 ...), or null when the client did not send a usable one. */
export function parseOrder(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1000 ? Math.floor(value) : null;
}

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
            const repsRight = typeof s.repsRight === "number" ? s.repsRight : null;
            const repsLeft = typeof s.repsLeft === "number" ? s.repsLeft : null;
            return {
              weight: typeof s.weight === "string" && s.weight.trim() ? s.weight.trim() : null,
              reps: reps !== null && Number.isFinite(reps) && reps >= 0 ? Math.floor(reps) : null,
              setType: parseSetType(s.setType),
              repsRight: repsRight !== null && Number.isFinite(repsRight) && repsRight >= 0 ? Math.floor(repsRight) : null,
              repsLeft: repsLeft !== null && Number.isFinite(repsLeft) && repsLeft >= 0 ? Math.floor(repsLeft) : null,
            };
          })
          .filter((s) => s.weight !== null || s.reps !== null || s.repsRight !== null || s.repsLeft !== null || s.setType !== null)
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
        order: parseOrder(e.order),
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
        const repsLabel =
          s.repsRight !== null && s.repsRight !== undefined && s.repsLeft !== null && s.repsLeft !== undefined
            ? `R${s.repsRight}/L${s.repsLeft}`
            : s.reps !== null
              ? `×${s.reps}${perSideSuffix}`
              : null;
        const load = s.weight && repsLabel
          ? `${s.weight}${repsLabel.startsWith("R") ? " " : ""}${repsLabel}`
          : s.weight
            ? s.weight
            : (repsLabel ?? "—");
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

// Cardio pieces logged alongside a session ("Add cardio"). Older entries
// have no type and are runs.
export const CARDIO_TYPES = ["run", "walk", "treadmill_walk", "stair_climber", "bike", "rower", "cross_trainer", "other"] as const;
export type CardioType = (typeof CARDIO_TYPES)[number];

export function parseCardioFields(r: Record<string, unknown>): { cardioType?: CardioType; level?: number | null; order?: number | null; supersetGroup?: string | null } {
  const cardioType = CARDIO_TYPES.includes(r.cardioType as CardioType) ? (r.cardioType as CardioType) : undefined;
  const level = typeof r.level === "number" && Number.isFinite(r.level) && r.level >= 0 && r.level <= 30 ? Math.round(r.level * 10) / 10 : null;
  const order = parseOrder(r.order);
  const supersetGroup = typeof r.supersetGroup === "string" && r.supersetGroup.trim() ? r.supersetGroup.trim().slice(0, 20) : null;
  return { ...(cardioType ? { cardioType, level } : {}), ...(order !== null ? { order } : {}), ...(supersetGroup ? { supersetGroup } : {}) };
}

// Cardio rows arriving from a client, in the same shape a member's own session keeps them in. A row with nothing in it is dropped.
export function parseRunEntries(runs: unknown): WorkoutRunEntry[] {
  if (!Array.isArray(runs)) return [];
  return runs.flatMap((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const distanceRaw = typeof r.distance === "number" ? r.distance : null;
    const durationRaw = typeof r.durationSecs === "number" ? r.durationSecs : null;
    const repsRaw = typeof r.reps === "number" ? r.reps : null;
    const setsRaw = typeof r.sets === "number" ? r.sets : null;
    const distance = distanceRaw !== null && Number.isFinite(distanceRaw) && distanceRaw >= 0 ? Math.round(distanceRaw * 1000) / 1000 : null;
    const durationSecs = durationRaw !== null && Number.isFinite(durationRaw) && durationRaw >= 0 ? Math.floor(durationRaw) : null;
    const notes = typeof r.notes === "string" && r.notes.trim() ? r.notes.trim() : null;
    const cardio = parseCardioFields(r);
    if (distance === null && durationSecs === null && !notes && !cardio.cardioType && repsRaw === null && setsRaw === null) return [];
    return [
      {
        distance,
        distanceUnit: "km" as const,
        durationSecs,
        reps: repsRaw !== null && Number.isFinite(repsRaw) && repsRaw >= 0 ? Math.floor(repsRaw) : null,
        sets: setsRaw !== null && Number.isFinite(setsRaw) && setsRaw >= 0 ? Math.floor(setsRaw) : null,
        notes,
        ...cardio,
      } satisfies WorkoutRunEntry,
    ];
  });
}
