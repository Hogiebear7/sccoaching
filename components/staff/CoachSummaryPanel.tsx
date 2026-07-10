"use client";

import { useState } from "react";

export function CoachSummaryPanel({ memberId }: { memberId: string }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleGenerate() {
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/ai/coach-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.message ?? "Could not generate a summary. Please try again.");
        return;
      }

      setSummary(data.summary ?? null);
      setConfigured(Boolean(data.configured));
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="panel p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-semibold">Coach summary (AI)</h3>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isLoading}
          className="self-start rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
        >
          {isLoading ? "Generating…" : "Generate summary"}
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {summary ? (
        <p className={`mt-4 text-sm ${configured ? "text-foreground" : "text-muted-foreground"}`}>
          {summary}
        </p>
      ) : !error ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Generate a quick AI-assisted summary of this member&apos;s recent training and recovery.
        </p>
      ) : null}
    </div>
  );
}
