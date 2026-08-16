"use client";

import { useEffect, useState } from "react";

import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import type { ExerciseImportLogRecord } from "@/lib/exercise-library/types";
import type { ExerciseLibraryRecord } from "@/lib/exercise-library/types";

type ImportRunResult = {
  batchId: string;
  mode: "dry_run" | "import";
  totalRows: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  mediaMappedCount: number;
  mediaMissingCount: number;
  details: { sourceId: string; name: string; outcome: string; message?: string; mediaFound: number; mediaUploaded: number }[];
  catalogCoverage: { totalNamesInList: number | null; matchedDetailFiles: number } | null;
};

export function ExerciseLibraryAdminView() {
  const [packs, setPacks] = useState<string[]>([]);
  const [selectedPack, setSelectedPack] = useState<string>("");
  const [running, setRunning] = useState<"dry_run" | "import" | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ImportRunResult | null>(null);

  const [logs, setLogs] = useState<ExerciseImportLogRecord[]>([]);
  const [exercises, setExercises] = useState<ExerciseLibraryRecord[]>([]);
  const [exercisesLoading, setExercisesLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [approvedFilter, setApprovedFilter] = useState<"all" | "true" | "false">("all");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/staff/exercise-library/import")
      .then((r) => r.json())
      .then((data) => {
        const list: string[] = data?.packs ?? [];
        setPacks(list);
        if (list.length > 0) setSelectedPack((prev) => prev || list[0]);
      })
      .catch(() => {});
  }, []);

  function loadLogs() {
    fetch("/api/staff/exercise-library/logs")
      .then((r) => r.json())
      .then((data) => setLogs(data?.logs ?? []))
      .catch(() => {});
  }

  function loadExercises() {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (approvedFilter !== "all") params.set("approved", approvedFilter);
    fetch(`/api/staff/exercise-library?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setExercises(data?.exercises ?? []))
      .catch(() => {})
      .finally(() => setExercisesLoading(false));
  }

  useEffect(() => {
    loadLogs();
    loadExercises();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      setExercisesLoading(true);
      loadExercises();
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, approvedFilter]);

  async function runImport(mode: "dry_run" | "import") {
    if (!selectedPack) return;
    setRunning(mode);
    setRunError(null);
    try {
      const res = await fetch("/api/staff/exercise-library/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack: selectedPack, mode }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRunError(data?.message ?? "Import failed.");
        return;
      }
      setLastResult(data.result);
      if (mode === "import") {
        loadLogs();
        loadExercises();
      }
    } catch {
      setRunError("Could not reach the server.");
    } finally {
      setRunning(null);
    }
  }

  async function toggleApproved(id: string, approved: boolean) {
    setTogglingId(id);
    try {
      const res = await fetch(`/api/staff/exercise-library/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved }),
      });
      if (res.ok) {
        setExercises((prev) => prev.map((e) => (e.id === id ? { ...e, approved } : e)));
      }
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Staff"
        title="Exercise Library"
        subtitle="Import a source pack, review what came in, and approve exercises before members can see them in the app."
      />

      <Card className="space-y-4 p-6">
        <div>
          <p className="label-caps">Import</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Run a dry run first to see exactly what would happen — nothing is written until you run the real import.
          </p>
        </div>

        {packs.length === 0 ? (
          <p className="well px-4 py-3 text-sm text-muted-foreground">
            No packs found in <code>import-data/</code>. Copy a source pack there first (see{" "}
            <code>import-data/README.md</code>).
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedPack}
              onChange={(e) => setSelectedPack(e.target.value)}
              className="input-field w-auto"
            >
              {packs.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={() => runImport("dry_run")} disabled={running !== null}>
              {running === "dry_run" ? "Running dry run…" : "Dry run"}
            </Button>
            <Button variant="primary" onClick={() => runImport("import")} disabled={running !== null}>
              {running === "import" ? "Importing…" : "Import for real"}
            </Button>
          </div>
        )}

        {runError ? <p className="text-sm text-red-400">{runError}</p> : null}

        {lastResult ? (
          <div className="well space-y-2 px-4 py-4">
            <p className="text-sm font-medium text-foreground">
              {lastResult.mode === "dry_run" ? "Dry run result" : "Import result"} — scanned {lastResult.totalRows}{" "}
              exercise file(s)
            </p>
            {lastResult.catalogCoverage ? (
              <p className="text-xs text-muted-foreground">
                Catalog index: {lastResult.catalogCoverage.totalNamesInList} name(s) listed,{" "}
                {lastResult.catalogCoverage.matchedDetailFiles} have a full detail file in this pack.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>Created: {lastResult.importedCount}</span>
              <span>Updated: {lastResult.updatedCount}</span>
              <span>Failed: {lastResult.failedCount}</span>
              <span>Media mapped: {lastResult.mediaMappedCount}</span>
              <span>Media missing: {lastResult.mediaMissingCount}</span>
            </div>
            <div className="max-h-64 overflow-y-auto pt-2">
              {lastResult.details.map((row) => (
                <div key={row.sourceId} className="flex items-center justify-between border-t border-white/[0.06] py-1.5 text-xs">
                  <span className="text-foreground">
                    [{row.sourceId}] {row.name}
                  </span>
                  <span
                    className={
                      row.outcome === "failed"
                        ? "text-red-400"
                        : row.outcome === "created"
                          ? "text-emerald-400"
                          : "text-muted-foreground"
                    }
                  >
                    {row.outcome}
                    {row.message ? ` — ${row.message}` : ""} · media {row.mediaUploaded}/{row.mediaFound}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="space-y-3 p-6">
        <p className="label-caps">Recent import runs</p>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No real imports have been run yet.</p>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div key={log.id} className="well flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs">
                <span className="text-foreground">
                  {log.source} — {new Date(log.startedAt).toLocaleString()}
                </span>
                <span className="text-muted-foreground">
                  {log.status} · created {log.importedCount} · updated {log.updatedCount} · failed {log.failedCount} ·
                  media {log.mediaMappedCount}/{log.totalRows}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="label-caps">Inspect imported exercises</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name…"
              className="input-field w-56"
            />
            <select
              value={approvedFilter}
              onChange={(e) => setApprovedFilter(e.target.value as "all" | "true" | "false")}
              className="input-field w-auto"
            >
              <option value="all">All</option>
              <option value="false">Pending approval</option>
              <option value="true">Approved</option>
            </select>
          </div>
        </div>

        {exercisesLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : exercises.length === 0 ? (
          <p className="empty-state">No exercises match yet — run an import above.</p>
        ) : (
          <div className="space-y-2">
            {exercises.map((ex) => (
              <div key={ex.id} className="well flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{ex.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[ex.bodyPart, ex.equipment, ex.category].filter(Boolean).join(" · ") || "—"} · slug:{" "}
                    <code>{ex.slug}</code>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`chip label-caps ${ex.approved ? "!text-emerald-400" : "!text-amber-400"}`}>
                    {ex.approved ? "Approved" : "Pending"}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={togglingId === ex.id}
                    onClick={() => toggleApproved(ex.id, !ex.approved)}
                  >
                    {ex.approved ? "Unapprove" : "Approve"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
