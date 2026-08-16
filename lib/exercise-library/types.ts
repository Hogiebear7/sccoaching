// Raw shape of a per-exercise detail file in a source pack (e.g. the
// sample pack's 0025.json). Mirrors what the vendor's export actually
// contains — see import-data/README.md.
export interface SourceExerciseFile {
  id: string;
  name: string;
  bodyPart?: string;
  equipment?: string;
  target?: string;
  secondaryMuscles?: string[];
  instructions?: string[];
  description?: string;
  difficulty?: string;
  category?: string;
  taxonomy?: Record<string, unknown>;
  similarExercises?: RelatedExerciseRef[];
  substitutions?: RelatedExerciseRef[];
  progressions?: RelatedExerciseRef[];
  regressions?: RelatedExerciseRef[];
}

export interface RelatedExerciseRef {
  id: string;
  name: string;
  score?: number;
  confidence?: string;
  reasons?: string[];
  types?: string[];
}

export interface ExerciseLibraryRecord {
  id: string;
  source: string;
  sourceId: string | null;
  slug: string;
  name: string;
  aliases: string[];
  bodyPart: string | null;
  targetMuscle: string | null;
  secondaryMuscles: string[];
  equipment: string | null;
  category: string | null;
  difficulty: string | null;
  description: string | null;
  instructions: string[];
  taxonomy: Record<string, unknown> | null;
  isCustom: boolean;
  approved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExerciseMediaRecord {
  id: string;
  exerciseId: string;
  kind: string;
  resolution: string | null;
  storagePath: string;
  url: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  createdAt: string;
}

export type ImportMode = "dry_run" | "import";
export type ImportStatus = "running" | "completed" | "failed";
export type ImportRowOutcome = "created" | "updated" | "skipped" | "failed";

export interface ImportRowDetail {
  sourceId: string;
  name: string;
  outcome: ImportRowOutcome;
  message?: string;
  mediaFound: number;
  mediaUploaded: number;
}

export interface ExerciseImportLogRecord {
  id: string;
  batchId: string;
  source: string;
  mode: ImportMode;
  status: ImportStatus;
  totalRows: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  mediaMappedCount: number;
  mediaMissingCount: number;
  details: ImportRowDetail[];
  triggeredBy: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ImportRunResult {
  batchId: string;
  mode: ImportMode;
  totalRows: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  mediaMappedCount: number;
  mediaMissingCount: number;
  details: ImportRowDetail[];
  catalogCoverage: { totalNamesInList: number | null; matchedDetailFiles: number } | null;
}
