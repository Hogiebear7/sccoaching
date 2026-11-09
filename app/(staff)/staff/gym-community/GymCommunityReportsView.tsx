"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { GymReportRow } from "@/lib/gym-reports-view";
import { formatMembershipDate } from "@/lib/membership-status";

type Filter = "open" | "all" | "resolved" | "dismissed";

const STATUS_LABEL: Record<GymReportRow["status"], string> = { open: "Open", resolved: "Resolved", dismissed: "Dismissed" };
const STATUS_CLASS: Record<GymReportRow["status"], string> = {
  open: "bg-amber-500/15 text-amber-300",
  resolved: "bg-destructive/15 text-destructive",
  dismissed: "bg-primary/15 text-primary",
};
const TARGET_LABEL: Record<GymReportRow["targetType"], string> = { post: "Gym post", comment: "Gym comment", group: "Group" };
const REMOVE_LABEL: Record<GymReportRow["targetType"], string> = { post: "Remove post", comment: "Remove comment", group: "Close group" };
const AUTHOR_LABEL: Record<GymReportRow["targetType"], string> = { post: "Posted by", comment: "Written by", group: "Organised by" };

export function GymCommunityReportsView({ reports }: { reports: GymReportRow[] }) {
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
      const res = await fetch(`/api/staff/community/gym-reports/${id}/resolve`, {
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
        <h2 className="text-display mt-1 text-[28px] leading-tight">Gym community reports</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Posts and comments in your gym&apos;s members-only community, and groups, that members have reported. Removing takes a post or comment down for
          everyone, or closes the group. Dismissing closes the report and changes nothing. Check open reports regularly so anything that breaks the rules comes
          down promptly.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["open", "all", "resolved", "dismissed"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition ${
              filter === f ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:border-primary hover:text-foreground"
            }`}
          >
            {f}
            {f === "open" ? ` (${openCount})` : ""}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <div className="panel p-6" data-testid="gym-reports-empty">
          <p className="text-sm text-muted-foreground">No {filter === "all" ? "" : filter} reports.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => {
            const isBusy = busyId === r.id;
            return (
              <div key={r.id} className="panel p-5" data-testid="gym-report">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {TARGET_LABEL[r.targetType]} reported by {r.reporterName}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{formatMembershipDate(r.createdAt)}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                </div>

                <p className="mt-3 text-xs font-medium text-muted-foreground">Reason</p>
                <p className="text-sm text-foreground">{r.reason}</p>

                <p className="mt-3 text-xs font-medium text-muted-foreground">
                  {TARGET_LABEL[r.targetType]}
                  {r.author ? `. ${AUTHOR_LABEL[r.targetType]} ${r.author.displayName}${r.author.isStaff ? " (staff)" : ""}` : ""}
                </p>
                <p className="whitespace-pre-wrap text-sm text-foreground">{r.text ?? "(no longer available)"}</p>
                {r.alreadyRemoved ? <p className="mt-1 text-xs text-muted-foreground">Already removed.</p> : null}

                {r.status === "open" ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                    {r.alreadyRemoved ? null : (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => resolve(r.id, "resolve")}
                        className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isBusy ? "Working…" : REMOVE_LABEL[r.targetType]}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => resolve(r.id, "dismiss")}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {r.alreadyRemoved ? "Close report" : "Dismiss"}
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
