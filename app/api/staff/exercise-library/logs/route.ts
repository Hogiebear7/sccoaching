import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getExerciseLibraryClient } from "@/lib/exercise-library/admin-client";
import { authorizeStaffRequest } from "@/lib/staff-auth";
import type { ExerciseImportLogRecord } from "@/lib/exercise-library/types";

function mapLogRow(row: Record<string, unknown>): ExerciseImportLogRecord {
  return {
    id: row.id as string,
    batchId: row.batch_id as string,
    source: row.source as string,
    mode: row.mode as ExerciseImportLogRecord["mode"],
    status: row.status as ExerciseImportLogRecord["status"],
    totalRows: Number(row.total_rows ?? 0),
    importedCount: Number(row.imported_count ?? 0),
    updatedCount: Number(row.updated_count ?? 0),
    skippedCount: Number(row.skipped_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    mediaMappedCount: Number(row.media_mapped_count ?? 0),
    mediaMissingCount: Number(row.media_missing_count ?? 0),
    details: (row.details as ExerciseImportLogRecord["details"] | null) ?? [],
    triggeredBy: (row.triggered_by as string | null) ?? null,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
  };
}

export async function GET(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "exercises.manage");
  if (!auth.ok) return auth.response;

  const client = getExerciseLibraryClient();
  const { data, error } = await client
    .from("exercise_import_logs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[exercise-library] logs fetch failed:", error);
    return NextResponse.json({ success: false, message: "Could not load import logs." }, { status: 500 });
  }

  return NextResponse.json({ success: true, logs: (data ?? []).map(mapLogRow) });
}
