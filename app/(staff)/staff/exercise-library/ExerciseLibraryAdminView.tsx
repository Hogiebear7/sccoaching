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
  const [bodyPartFilter, setBodyPartFilter] = useState("");
  const [bodyPartOptions, setBodyPartOptions] = useState<string[]>([]);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [editingLibraryId, setEditingLibraryId] = useState<string | null>(null);
  const [editLibraryValues, setEditLibraryValues] = useState({ name: "", bodyPart: "", equipment: "" });
  const [editLibrarySaving, setEditLibrarySaving] = useState(false);
  const [editLibraryError, setEditLibraryError] = useState<string | null>(null);
  const [deletingLibraryId, setDeletingLibraryId] = useState<string | null>(null);
  const [libraryActionError, setLibraryActionError] = useState<string | null>(null);

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

  function loadExercises(pageOverride?: number) {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (approvedFilter !== "all") params.set("approved", approvedFilter);
    if (bodyPartFilter) params.set("bodyPart", bodyPartFilter);
    params.set("page", String(pageOverride ?? page));
    params.set("pageSize", String(pageSize));
    fetch(`/api/staff/exercise-library?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setExercises(data?.exercises ?? []);
        setTotal(data?.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setExercisesLoading(false));
  }

  useEffect(() => {
    loadLogs();
    loadExercises(1);
    fetch("/api/exercise-library")
      .then((r) => r.json())
      .then((data) => setBodyPartOptions(data?.filters?.bodyParts ?? []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any filter/search change resets to page 1 — a stale page number past the
  // end of a newly-filtered result set would otherwise render an empty list
  // with no obvious explanation.
  useEffect(() => {
    const id = setTimeout(() => {
      setExercisesLoading(true);
      setPage(1);
      loadExercises(1);
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, approvedFilter, bodyPartFilter]);

  function goToPage(next: number) {
    setPage(next);
    setExercisesLoading(true);
    loadExercises(next);
  }

  function startLibraryEdit(ex: ExerciseLibraryRecord) {
    setEditingLibraryId(ex.id);
    setEditLibraryValues({ name: ex.name, bodyPart: ex.bodyPart ?? "", equipment: ex.equipment ?? "" });
    setEditLibraryError(null);
  }

  function cancelLibraryEdit() {
    setEditingLibraryId(null);
    setEditLibraryError(null);
  }

  async function saveLibraryEdit(id: string) {
    setEditLibraryError(null);
    setEditLibrarySaving(true);
    try {
      const res = await fetch(`/api/staff/exercise-library/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editLibraryValues),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setEditLibraryError(data?.message ?? "Could not save changes.");
        return;
      }
      setEditingLibraryId(null);
      loadExercises();
    } catch {
      setEditLibraryError("Could not reach the server.");
    } finally {
      setEditLibrarySaving(false);
    }
  }

  async function deleteLibraryExercise(ex: ExerciseLibraryRecord) {
    if (!window.confirm(`Delete "${ex.name}"? This removes it from the library and any member favorites. This can't be undone.`)) {
      return;
    }
    setLibraryActionError(null);
    setDeletingLibraryId(ex.id);
    try {
      const res = await fetch(`/api/staff/exercise-library/${ex.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setLibraryActionError(data?.message ?? "Could not delete this exercise.");
        return;
      }
      // Deleting the last row on a page would otherwise leave an
      // out-of-range page number showing nothing.
      const nextPage = exercises.length === 1 && page > 1 ? page - 1 : page;
      setPage(nextPage);
      loadExercises(nextPage);
    } catch {
      setLibraryActionError("Could not reach the server.");
    } finally {
      setDeletingLibraryId(null);
    }
  }

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
          <div>
            <p className="label-caps">Inspect imported exercises</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {total} exercise{total === 1 ? "" : "s"} total. Rename, reclassify, or remove any of them — deleting
              here removes it from the app and any member favorites, but never touches historical workout logs.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name…"
              className="input-field w-56"
            />
            <select
              value={bodyPartFilter}
              onChange={(e) => setBodyPartFilter(e.target.value)}
              className="input-field w-auto"
            >
              <option value="">All body parts</option>
              {bodyPartOptions.map((bp) => (
                <option key={bp} value={bp} className="capitalize">
                  {bp}
                </option>
              ))}
            </select>
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

        {libraryActionError ? (
          <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {libraryActionError}
          </p>
        ) : null}

        {exercisesLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : exercises.length === 0 ? (
          <p className="empty-state">No exercises match.</p>
        ) : (
          <div className="space-y-2">
            {exercises.map((ex) =>
              editingLibraryId === ex.id ? (
                <div key={ex.id} className="flex flex-col gap-2 rounded-2xl border border-primary/40 bg-background p-3 sm:flex-row sm:flex-wrap sm:items-end">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
                    <input
                      type="text"
                      value={editLibraryValues.name}
                      onChange={(e) => setEditLibraryValues((v) => ({ ...v, name: e.target.value }))}
                      className="w-full rounded-xl border border-border bg-input px-3 py-1.5 text-sm text-foreground outline-none transition focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
                      autoFocus
                    />
                  </div>
                  <div className="w-full sm:w-44">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Body part</label>
                    <input
                      type="text"
                      value={editLibraryValues.bodyPart}
                      onChange={(e) => setEditLibraryValues((v) => ({ ...v, bodyPart: e.target.value }))}
                      className="w-full rounded-xl border border-border bg-input px-3 py-1.5 text-sm text-foreground outline-none transition focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
                    />
                  </div>
                  <div className="w-full sm:w-44">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Equipment</label>
                    <input
                      type="text"
                      value={editLibraryValues.equipment}
                      onChange={(e) => setEditLibraryValues((v) => ({ ...v, equipment: e.target.value }))}
                      className="w-full rounded-xl border border-border bg-input px-3 py-1.5 text-sm text-foreground outline-none transition focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => saveLibraryEdit(ex.id)}
                      disabled={editLibrarySaving}
                      className="btn-primary px-3 py-1.5 text-xs disabled:opacity-60"
                    >
                      {editLibrarySaving ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelLibraryEdit}
                      className="rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
                    >
                      Cancel
                    </button>
                  </div>
                  {editLibraryError ? <p className="w-full text-xs text-destructive">{editLibraryError}</p> : null}
                </div>
              ) : (
                <div key={ex.id} className="well flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
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
                    <Button variant="secondary" size="sm" onClick={() => startLibraryEdit(ex)}>
                      Edit
                    </Button>
                    <button
                      type="button"
                      onClick={() => deleteLibraryExercise(ex)}
                      disabled={deletingLibraryId === ex.id}
                      className="rounded-xl border border-destructive/30 px-3 py-1 text-xs font-medium text-destructive transition hover:border-destructive/60 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deletingLibraryId === ex.id ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}

        {total > pageSize ? (
          <div className="flex items-center justify-between gap-3 pt-2">
            <p className="text-xs text-muted-foreground">
              Page {page} of {Math.max(1, Math.ceil(total / pageSize))}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= Math.ceil(total / pageSize)}
                onClick={() => goToPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
