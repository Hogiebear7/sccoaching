import type { ExerciseLibraryRecord, ExerciseMediaRecord } from "./types";

// snake_case (Postgres) -> camelCase (app) — kept in one place so every
// route that reads these tables agrees on the shape.
export function mapExerciseRow(row: Record<string, unknown>): ExerciseLibraryRecord {
  return {
    id: row.id as string,
    source: row.source as string,
    sourceId: (row.source_id as string | null) ?? null,
    slug: row.slug as string,
    name: row.name as string,
    aliases: (row.aliases as string[] | null) ?? [],
    bodyPart: (row.body_part as string | null) ?? null,
    targetMuscle: (row.target_muscle as string | null) ?? null,
    secondaryMuscles: (row.secondary_muscles as string[] | null) ?? [],
    equipment: (row.equipment as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    difficulty: (row.difficulty as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    instructions: (row.instructions as string[] | null) ?? [],
    taxonomy: (row.taxonomy as Record<string, unknown> | null) ?? null,
    isCustom: Boolean(row.is_custom),
    approved: Boolean(row.approved),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapMediaRow(row: Record<string, unknown>): ExerciseMediaRecord {
  return {
    id: row.id as string,
    exerciseId: row.exercise_id as string,
    kind: row.kind as string,
    resolution: (row.resolution as string | null) ?? null,
    storagePath: row.storage_path as string,
    url: row.url as string,
    width: (row.width as number | null) ?? null,
    height: (row.height as number | null) ?? null,
    bytes: (row.bytes as number | null) ?? null,
    createdAt: row.created_at as string,
  };
}
