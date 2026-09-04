import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiUsageLogRecord } from "@/lib/db";

const { mockCreateAiUsageLog } = vi.hoisted(() => ({
  mockCreateAiUsageLog: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  createAiUsageLog: mockCreateAiUsageLog,
}));

import { rangeBoundsISO, recordAiUsage, recordAiUsageFromResponse, summarizeAiUsage, usdToEur } from "@/lib/ai-usage";

function makeLog(overrides: Partial<AiUsageLogRecord> = {}): AiUsageLogRecord {
  return {
    id: "log-1",
    userId: "user-1",
    feature: "coach_chat",
    model: "claude-opus-4-8",
    inputTokens: 1000,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 500,
    costUsd: 0.05,
    createdAt: "2026-06-15T10:00:00.000Z",
    ...overrides,
  };
}

describe("recordAiUsage", () => {
  beforeEach(() => {
    mockCreateAiUsageLog.mockClear();
  });

  it("computes cost from real input/output tokens at the model's base rate", () => {
    recordAiUsage({
      userId: "user-1",
      feature: "coach_chat",
      model: "claude-opus-4-8",
      inputTokens: 1000,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 500,
    });

    expect(mockCreateAiUsageLog).toHaveBeenCalledTimes(1);
    const log = mockCreateAiUsageLog.mock.calls[0][0] as AiUsageLogRecord;
    // (1000 * 5 + 500 * 25) / 1_000_000 = 0.0175
    expect(log.costUsd).toBeCloseTo(0.0175, 6);
  });

  it("applies the cache write (1.25x) and cache read (0.1x) multipliers", () => {
    recordAiUsage({
      userId: "user-1",
      feature: "coach_chat",
      model: "claude-opus-4-8",
      inputTokens: 0,
      cacheWriteTokens: 1000,
      cacheReadTokens: 1000,
      outputTokens: 0,
    });

    const log = mockCreateAiUsageLog.mock.calls[0][0] as AiUsageLogRecord;
    // (1000 * 5 * 1.25 + 1000 * 5 * 0.1) / 1_000_000 = 0.00675
    expect(log.costUsd).toBeCloseTo(0.00675, 6);
  });

  it("falls back to the opus-4-8 rate for an unrecognized model rather than throwing", () => {
    expect(() =>
      recordAiUsage({
        userId: null,
        feature: "exercise_content",
        model: "some-future-model",
        inputTokens: 1000,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
      })
    ).not.toThrow();

    const log = mockCreateAiUsageLog.mock.calls[0][0] as AiUsageLogRecord;
    expect(log.costUsd).toBeCloseTo(0.005, 6); // 1000 * 5 / 1_000_000
  });

  it("never throws when the underlying DB write fails", () => {
    mockCreateAiUsageLog.mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    expect(() =>
      recordAiUsage({
        userId: "user-1",
        feature: "coach_chat",
        model: "claude-opus-4-8",
        inputTokens: 100,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 100,
      })
    ).not.toThrow();
  });
});

describe("recordAiUsageFromResponse", () => {
  beforeEach(() => {
    mockCreateAiUsageLog.mockClear();
  });

  it("maps a real Anthropic usage object's null cache fields to zero", () => {
    recordAiUsageFromResponse({
      userId: "user-1",
      feature: "workout_review",
      model: "claude-opus-4-8",
      usage: {
        input_tokens: 200,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        output_tokens: 150,
      },
    });

    const log = mockCreateAiUsageLog.mock.calls[0][0] as AiUsageLogRecord;
    expect(log.inputTokens).toBe(200);
    expect(log.cacheWriteTokens).toBe(0);
    expect(log.cacheReadTokens).toBe(0);
    expect(log.outputTokens).toBe(150);
  });
});

describe("usdToEur", () => {
  it("converts using the fixed mid-market rate", () => {
    expect(usdToEur(10)).toBeCloseTo(8.6, 6);
  });
});

describe("rangeBoundsISO", () => {
  // Local wall-clock constructor (not a UTC ISO string) — monthsAgo carries
  // now's local hour/day through setMonth, so pinning the local fields
  // directly keeps this test's expected values deterministic regardless of
  // the runner's timezone or DST, rather than an ISO-Z instant whose local
  // wall-clock hour would otherwise vary by TZ.
  const now = new Date(2026, 5, 15, 12, 0, 0);

  it("'month' starts at the 1st of the current calendar month, open-ended", () => {
    const { start, end } = rangeBoundsISO("month", now);
    expect(start).toBe(new Date(2026, 5, 1).toISOString());
    expect(end).toBeNull();
  });

  it("'last_month' bounds the full previous calendar month", () => {
    const { start, end } = rangeBoundsISO("last_month", now);
    expect(start).toBe(new Date(2026, 4, 1).toISOString());
    expect(end).toBe(new Date(2026, 5, 1).toISOString());
  });

  it("'3mo'/'6mo'/'year' are rolling trailing windows from now, open-ended", () => {
    expect(rangeBoundsISO("3mo", now).start).toBe(new Date(2026, 2, 15, 12).toISOString());
    expect(rangeBoundsISO("6mo", now).start).toBe(new Date(2025, 11, 15, 12).toISOString());
    expect(rangeBoundsISO("year", now).start).toBe(new Date(2025, 5, 15, 12).toISOString());
    expect(rangeBoundsISO("3mo", now).end).toBeNull();
  });

  it("'all' has no bounds", () => {
    expect(rangeBoundsISO("all", now)).toEqual({ start: null, end: null });
  });
});

describe("summarizeAiUsage", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");

  it("filters to the requested range and totals cost across all matching logs", () => {
    const logs = [
      makeLog({ id: "a", createdAt: "2026-06-01T00:00:00.000Z", costUsd: 0.02 }), // this month
      makeLog({ id: "b", createdAt: "2026-05-01T00:00:00.000Z", costUsd: 0.05 }), // last month, outside "month"
      makeLog({ id: "c", createdAt: "2026-06-10T00:00:00.000Z", costUsd: 0.03 }), // this month
    ];

    const summary = summarizeAiUsage(logs, "month", now);
    expect(summary.totalCalls).toBe(2);
    expect(summary.totalCostEur).toBeCloseTo(usdToEur(0.05), 6);
  });

  it("groups by feature, sorted by cost descending", () => {
    const logs = [
      makeLog({ feature: "coach_chat", costUsd: 0.01, createdAt: "2026-06-05T00:00:00.000Z" }),
      makeLog({ feature: "programme_generation", costUsd: 0.05, createdAt: "2026-06-06T00:00:00.000Z" }),
      makeLog({ feature: "coach_chat", costUsd: 0.02, createdAt: "2026-06-07T00:00:00.000Z" }),
    ];

    const summary = summarizeAiUsage(logs, "month", now);
    expect(summary.byFeature).toHaveLength(2);
    expect(summary.byFeature[0].feature).toBe("programme_generation");
    expect(summary.byFeature[0].calls).toBe(1);
    expect(summary.byFeature[1].feature).toBe("coach_chat");
    expect(summary.byFeature[1].calls).toBe(2);
  });

  it("returns zeroed totals when there's nothing in range", () => {
    const summary = summarizeAiUsage([], "month", now);
    expect(summary.totalCalls).toBe(0);
    expect(summary.totalCostEur).toBe(0);
    expect(summary.byFeature).toEqual([]);
  });

  it("'all' includes logs regardless of date", () => {
    const logs = [makeLog({ createdAt: "2020-01-01T00:00:00.000Z" })];
    expect(summarizeAiUsage(logs, "all", now).totalCalls).toBe(1);
  });
});
