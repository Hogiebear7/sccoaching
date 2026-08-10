"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { FoodNutrition100g, FoodServing, FoodSubmissionRecord } from "@/lib/db";
import { formatMembershipDate } from "@/lib/membership-status";

interface SubmissionRow extends FoodSubmissionRecord {
  food: {
    id: string;
    name: string;
    brandName: string | null;
    barcode: string | null;
    nutrition100g: FoodNutrition100g;
    defaultServing: FoodServing;
  } | null;
  submitterEmail: string;
  submitterName: string | null;
}

type Filter = "pending_review" | "all" | "decided";

const STATUS_BADGE: Record<FoodSubmissionRecord["status"], { label: string; className: string }> = {
  pending_review: { label: "Pending review", className: "bg-amber-500/15 text-amber-300" },
  approved: { label: "Approved", className: "bg-primary/15 text-primary" },
  rejected: { label: "Rejected", className: "bg-destructive/15 text-destructive" },
  submitted_to_open_food_facts: { label: "Published", className: "bg-primary/15 text-primary" },
  failed: { label: "Publish failed", className: "bg-destructive/15 text-destructive" },
};

const DECIDED_STATUSES: FoodSubmissionRecord["status"][] = ["approved", "rejected", "submitted_to_open_food_facts", "failed"];

function scaleForServing(n100: FoodNutrition100g, grams: number) {
  const factor = grams / 100;
  return {
    calories: Math.round(n100.calories * factor),
    proteinG: Math.round(n100.proteinG * factor * 10) / 10,
    carbsG: Math.round(n100.carbsG * factor * 10) / 10,
    fatG: Math.round(n100.fatG * factor * 10) / 10,
  };
}

export function NutritionSubmissionsView({ submissions }: { submissions: SubmissionRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("pending_review");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const visible = submissions.filter((s) => {
    if (filter === "all") return true;
    if (filter === "pending_review") return s.status === "pending_review";
    return DECIDED_STATUSES.includes(s.status);
  });
  const pendingCount = submissions.filter((s) => s.status === "pending_review").length;

  async function review(id: string, decision: "approved" | "rejected") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/mobile/staff/nutrition/submissions/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision, note: noteDraft[id]?.trim() || undefined }),
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
        <h2 className="text-display mt-1 text-[28px] leading-tight">Food submissions</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Members opt in to share a custom food publicly via Open Food Facts. Review the nutrition details and any
          attached photos, then approve or reject — approving queues it for publishing (a live write only happens once
          Open Food Facts credentials are configured; see docs/food-catalog.md).
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["pending_review", "all", "decided"] as Filter[]).map((f) => (
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
            {f === "pending_review" ? `Pending (${pendingCount})` : f === "decided" ? "Decided" : "All"}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>
      ) : null}

      {visible.length === 0 ? (
        <div className="panel p-6">
          <p className="text-sm text-muted-foreground">No submissions to show.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((s) => {
            const isBusy = busyId === s.id;
            const badge = STATUS_BADGE[s.status];
            const perServing = s.food ? scaleForServing(s.food.nutrition100g, s.food.defaultServing.grams) : null;

            return (
              <div key={s.id} className="panel p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {s.food ? (s.food.brandName ? `${s.food.brandName} — ${s.food.name}` : s.food.name) : "Food no longer exists"}
                    </p>
                    <p className="text-xs text-muted-foreground">{s.submitterName ?? s.submitterEmail}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Submitted {formatMembershipDate(s.createdAt)}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>
                </div>

                {s.food ? (
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                    <span>Barcode: <span className="text-foreground">{s.food.barcode ?? "—"}</span></span>
                    <span>Serving: <span className="text-foreground">{s.food.defaultServing.label} ({s.food.defaultServing.grams}g)</span></span>
                    {perServing ? (
                      <>
                        <span>Calories: <span className="text-foreground">{perServing.calories} kcal</span></span>
                        <span>P / C / F: <span className="text-foreground">{perServing.proteinG}g / {perServing.carbsG}g / {perServing.fatG}g</span></span>
                      </>
                    ) : null}
                  </div>
                ) : null}

                {s.frontPhotoUrl || s.labelPhotoUrl ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {s.frontPhotoUrl ? (
                      <a href={s.frontPhotoUrl} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.frontPhotoUrl} alt={`Front of package for ${s.food?.name ?? "submitted food"}`} className="h-24 w-24 rounded-lg border border-border object-cover transition hover:opacity-80" />
                        <span className="text-[10px] text-muted-foreground">Front</span>
                      </a>
                    ) : null}
                    {s.labelPhotoUrl ? (
                      <a href={s.labelPhotoUrl} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.labelPhotoUrl} alt={`Nutrition label for ${s.food?.name ?? "submitted food"}`} className="h-24 w-24 rounded-lg border border-border object-cover transition hover:opacity-80" />
                        <span className="text-[10px] text-muted-foreground">Label</span>
                      </a>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">No photos attached.</p>
                )}

                <p className="mt-3 text-xs text-muted-foreground">
                  Consent given {s.consentedAt ? formatMembershipDate(s.consentedAt) : "—"}
                  {s.reviewedAt ? ` · Reviewed ${formatMembershipDate(s.reviewedAt)}` : ""}
                </p>

                {s.reviewNote ? (
                  <div className="mt-3 rounded-lg border border-border/60 bg-accent/30 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Review note</p>
                    <p className="mt-0.5 text-sm text-foreground">{s.reviewNote}</p>
                  </div>
                ) : null}

                {s.status === "pending_review" ? (
                  <div className="mt-4 space-y-2 border-t border-border/60 pt-3">
                    <textarea
                      value={noteDraft[s.id] ?? ""}
                      onChange={(e) => setNoteDraft((prev) => ({ ...prev, [s.id]: e.target.value }))}
                      placeholder="Note for the member (shown if rejected, e.g. what to fix before resubmitting)"
                      rows={2}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => review(s.id, "approved")}
                        className="btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isBusy ? "Saving…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => review(s.id, "rejected")}
                        className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
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
