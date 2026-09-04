import { randomUUID } from "crypto";

import { createAiUsageLog, type AiFeature, type AiUsageLogRecord } from "./db";

// Per-million-token USD pricing, keyed by the exact model id passed to the
// Anthropic API (see COACH_MODEL in lib/ai.ts). Anthropic bills in USD, so
// this is the ground-truth rate a logged call's costUsd is computed from —
// keep in sync with https://claude.com/pricing when the model changes.
// An unrecognized model id (e.g. ANTHROPIC_MODEL overridden to something
// not listed here) falls back to the opus-4-8 rate rather than throwing,
// since a slightly-off estimate is far better than losing the log entry.
const PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-5": { input: 2, output: 10 },
};
const DEFAULT_PRICING = PRICING_USD_PER_MTOK["claude-opus-4-8"];

function priceFor(model: string): { input: number; output: number } {
  return PRICING_USD_PER_MTOK[model] ?? DEFAULT_PRICING;
}

// Approximate mid-market USD->EUR rate — applied only at display time
// (summarizeUsage below), never baked into a stored log, so updating this
// constant never rewrites already-logged cost history in a currency the
// call was never actually billed in.
export const USD_TO_EUR = 0.86;

export function usdToEur(usd: number): number {
  return usd * USD_TO_EUR;
}

// Cache write/read multipliers on the base input rate — every prompt in
// lib/ai.ts caches its system prompt (cache_control: {type: "ephemeral"}),
// so ignoring these would materially misprice most calls: a cold cache
// costs 1.25x normal input, a warm one only 0.1x.
// https://platform.claude.com/docs/en/build-with-claude/prompt-caching
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

// Called right after every real client.messages.create() response in
// lib/ai.ts, with the token counts the API actually reported — never an
// estimate. Never throws: usage logging is telemetry, not core behavior,
// so a DB write failure here must not break the AI feature that triggered
// it (see the try/catch below).
export function recordAiUsage(input: {
  userId: string | null;
  feature: AiFeature;
  model: string;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}): void {
  try {
    const pricing = priceFor(input.model);
    const costUsd =
      (input.inputTokens * pricing.input +
        input.cacheWriteTokens * pricing.input * CACHE_WRITE_MULTIPLIER +
        input.cacheReadTokens * pricing.input * CACHE_READ_MULTIPLIER +
        input.outputTokens * pricing.output) /
      1_000_000;

    const log: AiUsageLogRecord = {
      id: randomUUID(),
      userId: input.userId,
      feature: input.feature,
      model: input.model,
      inputTokens: input.inputTokens,
      cacheWriteTokens: input.cacheWriteTokens,
      cacheReadTokens: input.cacheReadTokens,
      outputTokens: input.outputTokens,
      costUsd,
      createdAt: new Date().toISOString(),
    };

    createAiUsageLog(log);
  } catch (err) {
    console.error("[ai-usage] failed to record usage log:", err);
  }
}

// One-line call site for lib/ai.ts — takes the raw usage object straight off
// an Anthropic SDK response (client.messages.create()'s message.usage, or a
// stream's finalMessage().usage) so every call site stays a single line
// instead of repeating the null-coalescing for each field.
export function recordAiUsageFromResponse(input: {
  userId: string | null;
  feature: AiFeature;
  model: string;
  usage: {
    input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    output_tokens: number;
  };
}): void {
  recordAiUsage({
    userId: input.userId,
    feature: input.feature,
    model: input.model,
    inputTokens: input.usage.input_tokens ?? 0,
    cacheWriteTokens: input.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: input.usage.cache_read_input_tokens ?? 0,
    outputTokens: input.usage.output_tokens,
  });
}

export type AiUsageRange = "month" | "last_month" | "3mo" | "6mo" | "year" | "all";

export const AI_USAGE_RANGES: { value: AiUsageRange; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "3mo", label: "3 months" },
  { value: "6mo", label: "6 months" },
  { value: "year", label: "Year" },
  { value: "all", label: "All time" },
];

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthsAgo(d: Date, months: number): Date {
  const copy = new Date(d);
  copy.setMonth(copy.getMonth() - months);
  return copy;
}

// "month"/"last_month" are calendar-aligned reporting periods; "3mo"/"6mo"/
// "year" are rolling trailing windows from today (not calendar quarters or
// a calendar year) — the more useful reading for "how much has this member
// cost over the last N months," and simpler than reconciling partial vs.
// full calendar periods for those.
export function rangeBoundsISO(range: AiUsageRange, now: Date = new Date()): { start: string | null; end: string | null } {
  switch (range) {
    case "month":
      return { start: startOfMonth(now).toISOString(), end: null };
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = startOfMonth(now); // exclusive
      return { start: start.toISOString(), end: end.toISOString() };
    }
    case "3mo":
      return { start: monthsAgo(now, 3).toISOString(), end: null };
    case "6mo":
      return { start: monthsAgo(now, 6).toISOString(), end: null };
    case "year":
      return { start: monthsAgo(now, 12).toISOString(), end: null };
    case "all":
      return { start: null, end: null };
  }
}

export interface AiUsageFeatureBreakdown {
  feature: AiFeature;
  calls: number;
  costEur: number;
}

export interface AiUsageSummary {
  range: AiUsageRange;
  totalCalls: number;
  totalCostEur: number;
  byFeature: AiUsageFeatureBreakdown[];
}

// Exported for tests — pure aggregation over an already-fetched log list,
// so it doesn't need the real DB to be unit-tested.
export function summarizeAiUsage(
  logs: AiUsageLogRecord[],
  range: AiUsageRange,
  now: Date = new Date()
): AiUsageSummary {
  const { start, end } = rangeBoundsISO(range, now);
  const filtered = logs.filter((l) => (!start || l.createdAt >= start) && (!end || l.createdAt < end));

  const byFeatureUsd = new Map<AiFeature, { calls: number; costUsd: number }>();
  let totalCostUsd = 0;

  for (const log of filtered) {
    totalCostUsd += log.costUsd;
    const existing = byFeatureUsd.get(log.feature) ?? { calls: 0, costUsd: 0 };
    existing.calls += 1;
    existing.costUsd += log.costUsd;
    byFeatureUsd.set(log.feature, existing);
  }

  const byFeature: AiUsageFeatureBreakdown[] = [...byFeatureUsd.entries()]
    .map(([feature, v]) => ({ feature, calls: v.calls, costEur: usdToEur(v.costUsd) }))
    .sort((a, b) => b.costEur - a.costEur);

  return {
    range,
    totalCalls: filtered.length,
    totalCostEur: usdToEur(totalCostUsd),
    byFeature,
  };
}
