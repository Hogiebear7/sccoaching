"use client";

import { useMemo, useState, type ReactNode } from "react";

import { csvText, downloadCsv } from "@/lib/csv";

// The one table pattern for staff lists (admin revamp slice S3, docs/admin-revamp-plan-2026-10.md): a search box, filter chips, sortable
// columns, pages, and "Export this view", which downloads exactly the rows the current search and chip match (all pages), as CSV. Numbers are
// right-aligned with tabular figures. Client-side: the page passes rows it has already scoped to the staff member's gym.

export type Cell = string | number | null;

export interface DataTableColumn<Row> {
  key: string;
  header: string;
  /** The value used to sort and export. */
  value: (row: Row) => Cell;
  /** What is shown; defaults to the value. */
  render?: (row: Row) => ReactNode;
  numeric?: boolean;
  sortable?: boolean;
}

export interface DataTableChip<Row> {
  key: string;
  label: string;
  match: (row: Row) => boolean;
}

const PAGE_SIZES = [25, 50, 100] as const;

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  searchText,
  searchPlaceholder = "Search",
  chips,
  defaultChip,
  defaultSort,
  exportName,
  empty = "Nothing to show.",
}: {
  rows: Row[];
  columns: DataTableColumn<Row>[];
  rowKey: (row: Row) => string;
  /** The text a search matches against (name, email…). */
  searchText: (row: Row) => string;
  searchPlaceholder?: string;
  chips?: DataTableChip<Row>[];
  defaultChip?: string;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  /** File name stem for "Export this view"; no export button when absent. */
  exportName?: string;
  empty?: string;
}) {
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<string>(defaultChip ?? chips?.[0]?.key ?? "");
  const [sort, setSort] = useState(defaultSort ?? null);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(25);
  const [page, setPage] = useState(0);

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    const activeChip = chips?.find((c) => c.key === chip);
    const filtered = rows.filter((r) => (!activeChip || activeChip.match(r)) && (!q || searchText(r).toLowerCase().includes(q)));
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    if (!col || !sort) return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va === vb) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))) * dir;
    });
  }, [rows, query, chip, chips, sort, columns, searchText]);

  const pages = Math.max(1, Math.ceil(view.length / pageSize));
  const current = Math.min(page, pages - 1);
  const shown = view.slice(current * pageSize, (current + 1) * pageSize);
  const reset = () => setPage(0);
  const filtersOn = query.trim() !== "" || (chips && chip !== (defaultChip ?? chips[0]?.key));

  function toggleSort(key: string) {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    reset();
  }

  function exportView() {
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(`${exportName}-${date}.csv`, csvText(columns.map((c) => c.header), view.map((r) => columns.map((c) => c.value(r)))));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            reset();
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="min-w-[12rem] flex-1 rounded-xl border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
        />
        {chips?.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={chip === c.key}
            onClick={() => {
              setChip(c.key);
              reset();
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              chip === c.key ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:border-primary hover:text-foreground"
            }`}
          >
            {c.label}
          </button>
        ))}
        {filtersOn ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setChip(defaultChip ?? chips?.[0]?.key ?? "");
              reset();
            }}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Reset
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {view.length.toLocaleString("en-IE")} row{view.length === 1 ? "" : "s"}
          {view.length !== rows.length ? ` of ${rows.length.toLocaleString("en-IE")}` : ""}
        </span>
        {exportName ? (
          <button type="button" onClick={exportView} disabled={view.length === 0} className="font-semibold text-gold hover:text-gold/80 disabled:opacity-50">
            Export this view ({view.length.toLocaleString("en-IE")} rows, CSV)
          </button>
        ) : null}
      </div>

      {view.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {columns.map((c) => {
                  const active = sort?.key === c.key;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                      className={`px-3 py-2 font-medium ${c.numeric ? "text-right" : ""}`}
                    >
                      {c.sortable === false ? (
                        c.header
                      ) : (
                        <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-foreground">
                          {c.header}
                          <span aria-hidden className={active ? "text-foreground" : "opacity-30"}>
                            {active && sort!.dir === "desc" ? "↓" : "↑"}
                          </span>
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={rowKey(r)} className="border-t border-white/[0.06]">
                  {columns.map((c) => (
                    <td key={c.key} className={`px-3 py-2 ${c.numeric ? "text-right tabular-nums" : ""}`}>
                      {c.render ? c.render(r) : (c.value(r) ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view.length > PAGE_SIZES[0] ? (
        <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <label className="flex items-center gap-2 text-muted-foreground">
            Rows per page
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number]);
                reset();
              }}
              className="rounded-lg border border-border bg-transparent px-2 py-1"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span className="flex items-center gap-3">
            <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="text-gold disabled:opacity-40">
              ← Previous
            </button>
            <span className="text-muted-foreground">
              Page {current + 1} of {pages}
            </span>
            <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="text-gold disabled:opacity-40">
              Next →
            </button>
          </span>
        </nav>
      ) : null}
    </div>
  );
}
