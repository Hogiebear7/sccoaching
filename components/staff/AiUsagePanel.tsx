"use client";

import { useEffect, useState } from "react";

interface AiUsageFeatureBreakdown {
  feature: string;
  calls: number;
  costEur: number;
}

interface AiUsageSummary {
  range: string;
  totalCalls: number;
  totalCostEur: number;
  byFeature: AiUsageFeatureBreakdown[];
}

const RANGES: { value: string; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "3mo", label: "3 months" },
  { value: "6mo", label: "6 months" },
  { value: "year", label: "Year" },
  { value: "all", label: "All time" },
];

// Mirrors AiFeature in the main repo's lib/db.ts — one label per feature so
// the breakdown reads like a bill, not a list of internal enum values.
const FEATURE_LABEL: Record<string, string> = {
  coach_chat: "AI Coach chat",
  nutrition_coach_chat: "AI Nutrition Coach chat",
  staff_member_summary: "Staff summary",
  staff_draft_reply: "Staff draft reply",
  exercise_content: "Exercise content",
  meal_suggestions: "Meal suggestions",
  food_photo_scan: "Food photo scan",
  food_description: "Food text description",
  receipt_scan: "Receipt scan",
  workout_review: "Post-workout review",
  tracker_import: "Tracker import",
  programme_generation: "Programme generation",
  programme_checkin: "Programme check-in",
};

// Small totals (most single ranges) round to nothing at 2dp, so show more
// precision below €1 and settle to normal currency formatting above it.
function formatEur(n: number): string {
  const digits = n < 1 ? 4 : 2;
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

export function AiUsagePanel({ memberId }: { memberId: string }) {
  const [range, setRange] = useState("month");
  const [summary, setSummary] = useState<AiUsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetch(`/api/staff/members/${memberId}/ai-usage?range=${range}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.message ?? "Could not load AI usage.");
        return data.data as AiUsageSummary;
      })
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load AI usage.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [memberId, range]);

  return (
    <div className="panel p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-semibold">AI usage</h3>
        <div className="flex flex-wrap gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRange(r.value)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                range === r.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      ) : summary ? (
        <>
          <div className="mt-4 flex items-baseline gap-3">
            <span className="text-2xl font-semibold">{formatEur(summary.totalCostEur)}</span>
            <span className="text-sm text-muted-foreground">
              {summary.totalCalls} call{summary.totalCalls === 1 ? "" : "s"}
            </span>
          </div>

          {summary.byFeature.length > 0 ? (
            <ul className="mt-4 space-y-1.5 text-sm">
              {summary.byFeature.map((f) => (
                <li
                  key={f.feature}
                  className="flex items-center justify-between border-b border-border/60 py-1.5 last:border-0"
                >
                  <span className="text-foreground">{FEATURE_LABEL[f.feature] ?? f.feature}</span>
                  <span className="text-muted-foreground">
                    {f.calls} call{f.calls === 1 ? "" : "s"} · {formatEur(f.costEur)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No AI usage in this period.</p>
          )}
        </>
      ) : null}
    </div>
  );
}
