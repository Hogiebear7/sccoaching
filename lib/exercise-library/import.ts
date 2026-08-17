import { randomUUID } from "crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { extname, join, resolve } from "path";

import { EXERCISE_MEDIA_BUCKET, getExerciseLibraryClient } from "./admin-client";
import { slugify } from "./slug";
import type {
  ExerciseLibraryRecord,
  ImportMode,
  ImportRowDetail,
  ImportRunResult,
  SourceExerciseFile,
} from "./types";

// Any file "<sourceId>-<label>.gif" next to "<sourceId>.json" in the same
// directory is treated as a media variant — the label (e.g. "180", "360",
// "1080") is stored as-is as the resolution tag. This is deliberately
// pattern-based rather than a hardcoded resolution list, so a future full
// pack with a different resolution ladder (or an extra angle/format) needs
// no code change, only to follow the same "<sourceId>-<label>.<ext>" shape
// documented in import-data/README.md.
const MEDIA_EXT_TO_CONTENT_TYPE: Record<string, string> = {
  ".gif": "image/gif",
};

const IMPORT_DATA_ROOT = resolve(process.cwd(), "import-data");

// Staff pick a pack by name from the admin UI (never a free-typed path) —
// this both lists what's available and validates a requested name resolves
// safely inside import-data/, not somewhere else on the server filesystem.
export function listAvailablePacks(): string[] {
  if (!existsSync(IMPORT_DATA_ROOT)) return [];
  return readdirSync(IMPORT_DATA_ROOT).filter((name) => statSync(join(IMPORT_DATA_ROOT, name)).isDirectory());
}

export function resolvePackDir(packName: string): string | null {
  const dir = resolve(IMPORT_DATA_ROOT, packName);
  if (!dir.startsWith(IMPORT_DATA_ROOT) || !existsSync(dir) || !statSync(dir).isDirectory()) return null;
  return dir;
}

interface ScannedExercise {
  sourceId: string;
  jsonPath: string;
  mediaFiles: { resolution: string; path: string; ext: string }[];
}

function scanSourcePack(dir: string): { exercises: ScannedExercise[]; exerciseListCount: number | null } {
  const entries = readdirSync(dir);
  const jsonFiles = entries.filter((f) => f.toLowerCase().endsWith(".json") && f !== "exerciseList.json");

  let exerciseListCount: number | null = null;
  if (entries.includes("exerciseList.json")) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, "exerciseList.json"), "utf-8"));
      exerciseListCount = Array.isArray(raw) ? raw.length : null;
    } catch {
      exerciseListCount = null;
    }
  }

  const exercises: ScannedExercise[] = jsonFiles.map((jsonFile) => {
    const sourceId = jsonFile.replace(/\.json$/i, "");
    const prefix = `${sourceId}-`;
    const mediaFiles = entries
      .filter((f) => f.startsWith(prefix) && MEDIA_EXT_TO_CONTENT_TYPE[extname(f).toLowerCase()])
      .map((f) => ({
        resolution: f.slice(prefix.length, f.length - extname(f).length),
        path: join(dir, f),
        ext: extname(f).toLowerCase(),
      }));
    return { sourceId, jsonPath: join(dir, jsonFile), mediaFiles };
  });

  return { exercises, exerciseListCount };
}

// Source packs vary in casing (some all-lowercase, like ExerciseDB's) —
// title-case on import so the display name is consistent regardless of
// source. Matches Postgres's initcap() behavior (used for the one-off
// backfill of exercises imported before this existed): capitalize the
// first letter of every run of letters, lowercase the rest — hyphens,
// slashes, and parens act as natural word boundaries without special-casing.
function titleCase(s: string): string {
  return s.replace(/[a-zA-Z]+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

// Pure mapping — exported for unit testing without touching Supabase.
export function mapSourceFileToRecord(
  raw: SourceExerciseFile,
  source: string
): Omit<ExerciseLibraryRecord, "id" | "slug" | "approved" | "createdAt" | "updatedAt"> {
  const norm = (v: string | undefined | null) => (v && v.trim() ? v.trim().toLowerCase() : null);

  return {
    source,
    sourceId: raw.id,
    name: titleCase(raw.name.trim()),
    aliases: [],
    bodyPart: norm(raw.bodyPart),
    targetMuscle: norm(raw.target),
    secondaryMuscles: (raw.secondaryMuscles ?? []).map((m) => m.trim().toLowerCase()).filter(Boolean),
    equipment: norm(raw.equipment),
    category: norm(raw.category),
    difficulty: norm(raw.difficulty),
    description: raw.description?.trim() || null,
    instructions: (raw.instructions ?? []).map((i) => i.trim()).filter(Boolean),
    taxonomy: {
      ...raw.taxonomy,
      similarExercises: raw.similarExercises ?? [],
      substitutions: raw.substitutions ?? [],
      progressions: raw.progressions ?? [],
      regressions: raw.regressions ?? [],
    },
    isCustom: false,
  };
}

export interface RunImportInput {
  dir: string;
  source: string;
  mode: ImportMode;
  triggeredBy: string | null;
}

// Shared by the CLI script (scripts/import-exercise-library.mjs) and the
// staff-triggered admin route (app/api/staff/exercise-library/import) —
// one code path for both so "test with the sample pack" and "the real
// button in the app" can never drift apart.
export async function runExerciseImport(input: RunImportInput): Promise<ImportRunResult> {
  const { dir, source, mode, triggeredBy } = input;
  const client = getExerciseLibraryClient();
  const batchId = randomUUID();
  const startedAt = new Date().toISOString();

  const { exercises: scanned, exerciseListCount } = scanSourcePack(dir);

  const details: ImportRowDetail[] = [];
  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let mediaMappedCount = 0;
  let mediaMissingCount = 0;

  if (mode === "import") {
    await client.from("exercise_import_logs").insert({
      id: batchId,
      batch_id: batchId,
      source,
      mode,
      status: "running",
      total_rows: scanned.length,
      triggered_by: triggeredBy,
      started_at: startedAt,
    });
  }

  for (const item of scanned) {
    try {
      const raw = JSON.parse(readFileSync(item.jsonPath, "utf-8")) as SourceExerciseFile;
      const mapped = mapSourceFileToRecord(raw, source);

      const { data: existingRows, error: findError } = await client
        .from("exercises")
        .select("id, slug, approved")
        .eq("source", source)
        .eq("source_id", item.sourceId)
        .limit(1);

      if (findError) throw new Error(findError.message);
      const existing = existingRows?.[0] as { id: string; slug: string; approved: boolean } | undefined;

      let slug = existing?.slug ?? slugify(mapped.name);
      if (!existing) {
        // Disambiguate a slug collision against a *different* exercise
        // (same name imported from elsewhere, or a staff-added custom one).
        const { data: collision } = await client.from("exercises").select("id").eq("slug", slug).limit(1);
        if (collision && collision.length > 0) slug = `${slug}-${item.sourceId}`;
      }

      let exerciseId = existing?.id ?? null;

      if (mode === "import") {
        if (existing) {
          const { error: updateError } = await client
            .from("exercises")
            .update({
              name: mapped.name,
              aliases: mapped.aliases,
              body_part: mapped.bodyPart,
              target_muscle: mapped.targetMuscle,
              secondary_muscles: mapped.secondaryMuscles,
              equipment: mapped.equipment,
              category: mapped.category,
              difficulty: mapped.difficulty,
              description: mapped.description,
              instructions: mapped.instructions,
              taxonomy: mapped.taxonomy,
              updated_at: new Date().toISOString(),
              // approved intentionally left untouched — a re-import doesn't
              // silently re-hide an already-approved exercise, and doesn't
              // silently approve one a coach explicitly rejected either.
            })
            .eq("id", existing.id);
          if (updateError) throw new Error(updateError.message);
        } else {
          const { data: inserted, error: insertError } = await client
            .from("exercises")
            .insert({
              source,
              source_id: item.sourceId,
              slug,
              name: mapped.name,
              aliases: mapped.aliases,
              body_part: mapped.bodyPart,
              target_muscle: mapped.targetMuscle,
              secondary_muscles: mapped.secondaryMuscles,
              equipment: mapped.equipment,
              category: mapped.category,
              difficulty: mapped.difficulty,
              description: mapped.description,
              instructions: mapped.instructions,
              taxonomy: mapped.taxonomy,
              is_custom: false,
              approved: false,
            })
            .select("id")
            .single();
          if (insertError) throw new Error(insertError.message);
          exerciseId = inserted.id;
        }
      }

      let mediaUploaded = 0;
      if (mode === "import" && exerciseId) {
        for (const media of item.mediaFiles) {
          const buffer = readFileSync(media.path);
          const storagePath = `${source}/${item.sourceId}/${media.resolution}${media.ext}`;
          const contentType = MEDIA_EXT_TO_CONTENT_TYPE[media.ext] ?? "application/octet-stream";

          const { error: uploadError } = await client.storage
            .from(EXERCISE_MEDIA_BUCKET)
            .upload(storagePath, buffer, { contentType, upsert: true });
          if (uploadError) throw new Error(`media upload failed (${media.resolution}): ${uploadError.message}`);

          const { data: publicUrlData } = client.storage.from(EXERCISE_MEDIA_BUCKET).getPublicUrl(storagePath);

          const { error: mediaUpsertError } = await client
            .from("exercise_media")
            .upsert(
              {
                exercise_id: exerciseId,
                kind: "gif",
                resolution: media.resolution,
                storage_path: storagePath,
                url: publicUrlData.publicUrl,
                bytes: buffer.byteLength,
              },
              { onConflict: "exercise_id,kind,resolution" }
            );
          if (mediaUpsertError) throw new Error(`media row failed (${media.resolution}): ${mediaUpsertError.message}`);

          mediaUploaded += 1;
        }
      }

      const outcome = existing ? "updated" : "created";
      if (outcome === "updated") updatedCount += 1;
      else importedCount += 1;
      if (item.mediaFiles.length > 0) mediaMappedCount += 1;
      else mediaMissingCount += 1;

      details.push({
        sourceId: item.sourceId,
        name: mapped.name,
        outcome,
        mediaFound: item.mediaFiles.length,
        mediaUploaded,
      });
    } catch (err) {
      failedCount += 1;
      details.push({
        sourceId: item.sourceId,
        name: item.sourceId,
        outcome: "failed",
        message: err instanceof Error ? err.message : String(err),
        mediaFound: item.mediaFiles.length,
        mediaUploaded: 0,
      });
    }
  }

  skippedCount = 0; // reserved for future "unchanged, nothing to do" detection

  if (mode === "import") {
    await client
      .from("exercise_import_logs")
      .update({
        status: failedCount > 0 && importedCount === 0 && updatedCount === 0 ? "failed" : "completed",
        imported_count: importedCount,
        updated_count: updatedCount,
        skipped_count: skippedCount,
        failed_count: failedCount,
        media_mapped_count: mediaMappedCount,
        media_missing_count: mediaMissingCount,
        details,
        finished_at: new Date().toISOString(),
      })
      .eq("id", batchId);
  }

  return {
    batchId,
    mode,
    totalRows: scanned.length,
    importedCount,
    updatedCount,
    skippedCount,
    failedCount,
    mediaMappedCount,
    mediaMissingCount,
    details,
    catalogCoverage:
      exerciseListCount === null ? null : { totalNamesInList: exerciseListCount, matchedDetailFiles: scanned.length },
  };
}
