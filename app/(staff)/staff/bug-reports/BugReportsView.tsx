"use client";

// TRIAL-ONLY — see docs/bug-reports.md for the full removal checklist.

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { BugReportRecord } from "@/lib/db";
import { formatMembershipDate } from "@/lib/membership-status";

type ReportRow = BugReportRecord & { reporterEmail: string; reporterName: string | null };

type Filter = "all" | "open" | "resolved";

export function BugReportsView({ reports }: { reports: ReportRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = reports.filter((r) => filter === "all" || r.status === filter);
  const openCount = reports.filter((r) => r.status === "open").length;

  async function post(url: string, body: unknown, key: string) {
    setBusyId(key);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "Something went wrong.");
        return;
      }
      setConfirmDeleteId(null);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="label-caps">Staff</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">Bug reports</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Trial-period feedback submitted from Settings. This whole feature — this page, the
          member-facing form, and everything behind it — gets deleted before full launch.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["open", "all", "resolved"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition ${
              filter === f
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:border-primary hover:text-foreground"
            }`}
          >
            {f}
            {f === "open" ? ` (${openCount})` : ""}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <div className="panel p-6">
          <p className="text-sm text-muted-foreground">No {filter === "all" ? "" : filter} reports.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => {
            const isConfirming = confirmDeleteId === r.id;
            const isBusy = busyId === r.id;
            return (
              <div key={r.id} className="panel p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.reporterName ?? r.reporterEmail}</p>
                    {r.reporterName ? <p className="text-xs text-muted-foreground">{r.reporterEmail}</p> : null}
                    <p className="mt-0.5 text-xs text-muted-foreground">{formatMembershipDate(r.createdAt)}</p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      r.status === "open"
                        ? "bg-amber-500/15 text-amber-300"
                        : "bg-primary/15 text-primary"
                    }`}
                  >
                    {r.status === "open" ? "Open" : "Resolved"}
                  </span>
                </div>

                <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{r.description}</p>

                {r.screenshots.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {r.screenshots.map((src, i) => (
                      <a key={i} href={src} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={`Screenshot ${i + 1} from ${r.reporterEmail}`}
                          className="h-24 w-24 rounded-lg border border-border object-cover transition hover:opacity-80"
                        />
                      </a>
                    ))}
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() =>
                      post("/api/staff/bug-reports/status", { id: r.id, status: r.status === "open" ? "resolved" : "open" }, r.id)
                    }
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isBusy ? "Saving…" : r.status === "open" ? "Mark resolved" : "Reopen"}
                  </button>
                  {isConfirming ? (
                    <>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => post("/api/staff/bug-reports/delete", { id: r.id }, r.id)}
                        className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/20 disabled:opacity-60"
                      >
                        Confirm delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition hover:bg-accent"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(r.id)}
                      className="rounded-lg border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive transition hover:border-destructive/60"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
