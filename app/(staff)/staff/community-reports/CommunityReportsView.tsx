"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { CommentReportRecord } from "@/lib/db";
import { formatMembershipDate } from "@/lib/membership-status";

type ReportRow = CommentReportRecord & {
  reporterName: string;
  commentBody: string | null;
  commentAuthorName: string | null;
};

type Filter = "open" | "all" | "resolved" | "dismissed";

const STATUS_LABEL: Record<CommentReportRecord["status"], string> = {
  open: "Open",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

const STATUS_CLASS: Record<CommentReportRecord["status"], string> = {
  open: "bg-amber-500/15 text-amber-300",
  resolved: "bg-destructive/15 text-destructive",
  dismissed: "bg-primary/15 text-primary",
};

export function CommunityReportsView({ reports }: { reports: ReportRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = reports.filter((r) => filter === "all" || r.status === filter);
  const openCount = reports.filter((r) => r.status === "open").length;

  async function resolve(id: string, action: "resolve" | "dismiss") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/staff/community/reports/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "Something went wrong.");
        return;
      }
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
        <h2 className="text-display mt-1 text-[28px] leading-tight">Community reports</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Comments reported by members on the Community feed. Resolving removes the comment;
          dismissing closes the report with no action.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["open", "all", "resolved", "dismissed"] as Filter[]).map((f) => (
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
            const isBusy = busyId === r.id;
            return (
              <div key={r.id} className="panel p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Reported by {r.reporterName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{formatMembershipDate(r.createdAt)}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>

                <p className="mt-3 text-xs font-medium text-muted-foreground">Reason</p>
                <p className="text-sm text-foreground">{r.reason}</p>

                <p className="mt-3 text-xs font-medium text-muted-foreground">
                  Comment{r.commentAuthorName ? ` by ${r.commentAuthorName}` : ""}
                </p>
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {r.commentBody ?? "(already removed)"}
                </p>

                {r.status === "open" ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                    <button
                      type="button"
                      disabled={isBusy || !r.commentBody}
                      onClick={() => resolve(r.id, "resolve")}
                      className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isBusy ? "Working…" : "Remove comment"}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => resolve(r.id, "dismiss")}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
