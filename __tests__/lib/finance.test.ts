import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiUsageLogRecord } from "@/lib/db";
import { usdToEur } from "@/lib/finance-shared";

const h = vi.hoisted(() => ({
  findAllAiUsageLogs: vi.fn(),
  findAllFinanceLedgerEntries: vi.fn(),
  findAllPurchases: vi.fn(),
  findAllRevenueEvents: vi.fn(),
  findMembershipPackageById: vi.fn(),
  findProfileByUserId: vi.fn(),
}));

vi.mock("@/lib/db", () => h);

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

describe("buildFinanceLedgerLines — AI infrastructure cost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.findAllFinanceLedgerEntries.mockReturnValue([]);
    h.findAllPurchases.mockReturnValue([]);
    h.findAllRevenueEvents.mockReturnValue([]);
    h.findMembershipPackageById.mockReturnValue(undefined);
    h.findProfileByUserId.mockReturnValue(undefined);
  });

  it("returns no AI expense lines when there's no usage", async () => {
    h.findAllAiUsageLogs.mockReturnValue([]);
    const { buildFinanceLedgerLines } = await import("@/lib/finance");
    expect(buildFinanceLedgerLines()).toEqual([]);
  });

  it("aggregates same-day logs into a single day-dated expense line", async () => {
    h.findAllAiUsageLogs.mockReturnValue([
      makeLog({ id: "a", costUsd: 0.02, createdAt: "2026-06-15T09:00:00.000Z" }),
      makeLog({ id: "b", costUsd: 0.03, createdAt: "2026-06-15T18:30:00.000Z" }),
    ]);
    const { buildFinanceLedgerLines } = await import("@/lib/finance");
    const lines = buildFinanceLedgerLines();

    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.kind).toBe("expense");
    expect(line.status).toBe("cleared");
    expect(line.expenseType).toBe("ai_infrastructure");
    expect(line.origin).toBe("ai_usage");
    expect(line.memberId).toBeNull();
    expect(line.date).toBe("2026-06-15T12:00:00.000Z");
    expect(line.grossCents).toBe(Math.round(usdToEur(0.05) * 100));
    expect(line.netCents).toBe(line.grossCents);
    expect(line.notes).toBe("2 AI calls");
  });

  it("keeps different days as separate lines", async () => {
    h.findAllAiUsageLogs.mockReturnValue([
      makeLog({ id: "a", costUsd: 0.02, createdAt: "2026-06-15T09:00:00.000Z" }),
      makeLog({ id: "b", costUsd: 0.03, createdAt: "2026-06-16T09:00:00.000Z" }),
    ]);
    const { buildFinanceLedgerLines } = await import("@/lib/finance");
    const lines = buildFinanceLedgerLines();

    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.date).sort()).toEqual(["2026-06-15T12:00:00.000Z", "2026-06-16T12:00:00.000Z"]);
  });

  it("counts toward Money out via computeTotals like any other expense", async () => {
    h.findAllAiUsageLogs.mockReturnValue([makeLog({ costUsd: 1, createdAt: "2026-06-15T09:00:00.000Z" })]);
    const { buildFinanceLedgerLines } = await import("@/lib/finance");
    const { computeTotals } = await import("@/lib/finance-shared");
    const totals = computeTotals(buildFinanceLedgerLines());

    expect(totals.moneyOutCents).toBe(Math.round(usdToEur(1) * 100));
  });
});
