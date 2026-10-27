import { randomUUID } from "crypto";

import { createAiUsageLog, type AiFeature, type AiUsageLogRecord } from "./db";
import { USD_TO_EUR, usdToEur } from "./finance-shared";

// Re-exported for existing importers (e.g. __tests__/lib/ai-usage.test.ts) —
// USD_TO_EUR/usdToEur now live in lib/finance-shared.ts (client-safe, no
// Node dependency) since Finances' client view needs a client-safe currency
// conversion too, and this file already imports createAiUsageLog from ./db
// (Node's `fs`), making it unsafe to import from a "use client" file.
export { USD_TO_EUR, usdToEur };

// Per-million-token USD pricing, keyed by the exact model id passed to the
// Anthropic API (see COACH_MODEL in lib/ai.ts). Anthropic bills in USD, so
// this is the ground-truth rate a logged call's costUsd is computed from —
// keep in sync with https://claude.com/pricing when the model changes.
// An unrecognized model id (e.g. ANTHROPIC_MODEL overridden to something
// not listed here) falls back to the opus-4-8 rate rather than throwing,
// since a slightly-off estimate is far better than losing the log entry.
//
// Every billed token component has its own rate, and the cache-read rate differs by model (Sonnet 5.5 and Opus 5.5 charge 0.05x the input price for a cache
// read, the others 0.1x), so the table carries all five instead of multipliers. Verified against the published pricing page on 2026-10-16:
// https://platform.claude.com/docs/en/about-claude/pricing (global routing, standard tier, no batch discount).
export interface ModelRates {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}
const RATES_USD_PER_MTOK: Record<string, ModelRates> = {
  "claude-opus-4-8": { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  "claude-sonnet-4-6": { input: 3, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3, output: 15 },
  "claude-sonnet-5": { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10 },
  "claude-sonnet-5-5": { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 },
};
const DEFAULT_RATES = RATES_USD_PER_MTOK["claude-opus-4-8"];

/** The rates for a model, or null when this model's price is not known. Spending is never reserved or charged against a guess: callers that enforce a budget use this. */
export function ratesForKnownModel(model: string): ModelRates | null {
  return RATES_USD_PER_MTOK[model] ?? null;
}

export function priceFor(model: string): { input: number; output: number } {
  const r = RATES_USD_PER_MTOK[model] ?? DEFAULT_RATES;
  return { input: r.input, output: r.output };
}

// Every prompt in lib/ai.ts caches its system prompt (cache_control: {type: "ephemeral"}), so cache writes and reads must be priced: ignoring them would
// materially misprice most calls. https://platform.claude.com/docs/en/build-with-claude/prompt-caching

// The cost of a call from the token counts the provider reported (an unpriced model falls back to the Opus 4.8 rate: this is for LOGGING; enforcement refuses
// an unpriced model before any call, see lib/ai-metering.ts). Cache writes are charged at the 5-minute rate unless told otherwise.
export function costUsdFor(input: {
  model: string;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  /** Cache-write tokens that were written to the 1-hour cache (charged at the dearer 1-hour rate). */
  cacheWrite1hTokens?: number;
}): number {
  const r = ratesForKnownModel(input.model) ?? DEFAULT_RATES;
  const w1h = Math.min(input.cacheWrite1hTokens ?? 0, input.cacheWriteTokens);
  return (
    (input.inputTokens * r.input +
      (input.cacheWriteTokens - w1h) * r.cacheWrite5m +
      w1h * r.cacheWrite1h +
      input.cacheReadTokens * r.cacheRead +
      input.outputTokens * r.output) /
    1_000_000
  );
}

// Everything the provider can report as billable on a response, priced. Components this app does not use (web search, batch, priority tier, US-only
// inference) are still accounted if they ever appear, so the ledger cannot silently under-count: a recognised extra is priced, an unrecognised one is flagged
// (exact: false) and counted at +10%.
export interface ProviderUsage {
  input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
  output_tokens: number;
  server_tool_use?: { web_search_requests?: number | null; [other: string]: number | null | undefined } | null;
  service_tier?: string | null;
  inference_geo?: string | null;
}

export const WEB_SEARCH_USD_EACH = 0.01; // $10 per 1,000 searches
export const UNRECOGNISED_COMPONENT_MARKUP = 1.1; // also the documented US-only inference multiplier

export function costFromUsage(model: string, usage: ProviderUsage): {
  costUsd: number;
  exact: boolean;
  tokens: { input: number; cacheWrite: number; cacheRead: number; output: number };
} {
  const input = usage.input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const output = usage.output_tokens;
  let exact = ratesForKnownModel(model) !== null;

  // With a breakdown, 5-minute and 1-hour writes are priced separately; any tokens it does not account for, and a response with no breakdown, are charged at
  // the dearer 1-hour rate so the cache TTL can never cause under-counting.
  const bd = usage.cache_creation;
  const w5m = bd ? bd.ephemeral_5m_input_tokens ?? 0 : 0;
  const w1h = bd ? Math.max(cacheWrite - w5m, 0) : cacheWrite;

  let costUsd = costUsdFor({ model, inputTokens: input, cacheWriteTokens: cacheWrite, cacheReadTokens: cacheRead, outputTokens: output, cacheWrite1hTokens: w1h });

  const tools = usage.server_tool_use ?? null;
  if (tools) {
    for (const [name, count] of Object.entries(tools)) {
      if (!count) continue;
      costUsd += count * WEB_SEARCH_USD_EACH;
      if (name !== "web_search_requests") exact = false;
    }
  }
  const geo = usage.inference_geo;
  const tier = usage.service_tier;
  if ((geo && geo !== "global" && geo !== "not_available") || (tier && tier !== "standard")) {
    costUsd *= UNRECOGNISED_COMPONENT_MARKUP;
    exact = false;
  }
  return { costUsd, exact, tokens: { input, cacheWrite, cacheRead, output } };
}

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
    const costUsd = costUsdFor(input);

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
  /** The exact bounds this summary was filtered by (rangeBoundsISO's own
      output) — carried through to the client so a displayed date label can
      never drift from what the server actually filtered by. end is
      exclusive, per rangeBoundsISO's contract. */
  rangeStartISO: string | null;
  rangeEndISO: string | null;
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
    rangeStartISO: start,
    rangeEndISO: end,
    totalCalls: filtered.length,
    totalCostEur: usdToEur(totalCostUsd),
    byFeature,
  };
}
