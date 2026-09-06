// Classifies an exercise into a movement-pattern bucket for the structured
// (compound-first, alternating-antagonist) workout/programme templates —
// see lib/programme-exercise-picker.ts's pickStructuredExercisesForDay().
// Reads the exercise library's existing `taxonomy` JSONB column (already
// fully populated by the vendor import — see import-data/README.md) rather
// than requiring any new column or backfill: every approved exercise
// already carries `mechanic` ("compound"/"isolation"/"cardio"/...),
// `forceType` ("push"/"pull"/"knee_dominant"/"hip_dominant"/...), and
// `primaryRegion` ("upper_body"/"lower_body"/"core"/"cardio"/...).
//
// Mirrored (not shared — no package boundary between the repos) at
// sc-coaching-mobile/src/lib/movement-buckets.ts, same precedent as
// lib/equipment-matching.ts's own header comment.

export type MovementBucket = "upper_push" | "upper_pull" | "lower_push" | "lower_pull" | "core" | "tempo";
export type MainMovementBucket = "upper_push" | "upper_pull" | "lower_push" | "lower_pull";

export const MAIN_MOVEMENT_BUCKETS: MainMovementBucket[] = ["upper_push", "upper_pull", "lower_push", "lower_pull"];

function taxonomyString(taxonomy: Record<string, unknown> | null, key: string): string | null {
  const value = taxonomy?.[key];
  return typeof value === "string" ? value : null;
}

// Classifies an exercise's taxonomy into one of the 6 structured-template
// buckets, or null when it doesn't cleanly fit any of them (isolation
// accessories, stretching, mobility, rehab, balance, neck work, etc.) —
// those exercises remain usable by the older freeform body-part picker,
// just not eligible for the structured template's fixed slots.
export function classifyMovementBucket(taxonomy: Record<string, unknown> | null): MovementBucket | null {
  const forceType = taxonomyString(taxonomy, "forceType");
  const region = taxonomyString(taxonomy, "primaryRegion");
  const mechanic = taxonomyString(taxonomy, "mechanic");

  if (region === "core") return "core";
  if (region === "cardio" || mechanic === "cardio" || mechanic === "plyometric" || mechanic === "complex" || forceType === "carry") {
    return "tempo";
  }
  if (region === "upper_body" && forceType === "push") return "upper_push";
  if (region === "upper_body" && forceType === "pull") return "upper_pull";
  if (region === "lower_body" && (forceType === "knee_dominant" || forceType === "push")) return "lower_push";
  if (region === "lower_body" && forceType === "hip_dominant") return "lower_pull";

  return null;
}

// "Main lift" candidates for the 4 main buckets — the structured picker
// prefers these, falling back to any bucket member only when the compound
// sub-pool is exhausted for the member's equipment.
export function isCompoundExercise(taxonomy: Record<string, unknown> | null): boolean {
  return taxonomyString(taxonomy, "mechanic") === "compound";
}

export function bodyHalfOfBucket(bucket: MainMovementBucket): "upper" | "lower" {
  return bucket === "upper_push" || bucket === "upper_pull" ? "upper" : "lower";
}
