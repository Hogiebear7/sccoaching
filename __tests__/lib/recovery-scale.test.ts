import { describe, expect, it } from "vitest";

import { normalizeRecoveryScale, type RecoveryLogRecord } from "@/lib/db";
import { computeReadinessScore } from "@/lib/recovery";
import { formatFriendlyClassDate } from "@/lib/dates";

function log(partial: Partial<RecoveryLogRecord>): RecoveryLogRecord {
  return {
    id: "log-1",
    userId: "user-1",
    date: "2026-07-01",
    sleepHours: 8,
    sleepQuality: 3,
    soreness: 3,
    fatigue: 3,
    trainingDurationMins: null,
    rpe: null,
    goal: null,
    notes: null,
    readinessScore: 70,
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-01T08:00:00.000Z",
    ...partial,
  };
}

describe("recovery 1-10 scale", () => {
  it("readiness spans the full range on the new scale", () => {
    expect(
      computeReadinessScore({ sleepHours: 8, sleepQuality: 10, soreness: 1, fatigue: 1 })
    ).toBe(100);
    expect(
      computeReadinessScore({ sleepHours: 0, sleepQuality: 1, soreness: 10, fatigue: 5 })
    ).toBe(0);
  });

  it("midpoints land mid-range", () => {
    const score = computeReadinessScore({ sleepHours: 8, sleepQuality: 5, soreness: 5, fatigue: 3 });
    expect(score).toBeGreaterThan(55);
    expect(score).toBeLessThan(80);
  });

  it("legacy 1-5 entries double on read, keeping fatigue and stored score untouched", () => {
    const normalized = normalizeRecoveryScale(log({ sleepQuality: 4, soreness: 2, fatigue: 3 }));
    expect(normalized.sleepQuality).toBe(8);
    expect(normalized.soreness).toBe(4);
    expect(normalized.fatigue).toBe(3);
    expect(normalized.readinessScore).toBe(70);
    expect(normalized.scale10).toBe(true);
  });

  it("normalization is idempotent and preserves nulls", () => {
    const once = normalizeRecoveryScale(log({ sleepQuality: 5, soreness: 5 }));
    const twice = normalizeRecoveryScale(once);
    expect(twice.sleepQuality).toBe(10);
    expect(twice.soreness).toBe(10);

    const withNulls = normalizeRecoveryScale(log({ sleepQuality: null, soreness: null }));
    expect(withNulls.sleepQuality).toBeNull();
    expect(withNulls.soreness).toBeNull();
  });
});

describe("formatFriendlyClassDate", () => {
  const now = new Date(2026, 6, 14); // Tuesday 14 July 2026

  it("formats plain future dates as weekday day month", () => {
    expect(formatFriendlyClassDate("2026-07-25", now)).toBe("Saturday 25 July");
  });

  it("prefixes Tomorrow for exactly one calendar day ahead and Today for the same day", () => {
    expect(formatFriendlyClassDate("2026-07-15", now)).toBe("Tomorrow, Wednesday 15 July");
    expect(formatFriendlyClassDate("2026-07-14", now)).toBe("Today, Tuesday 14 July");
    // Two days out gets no prefix.
    expect(formatFriendlyClassDate("2026-07-16", now)).toBe("Thursday 16 July");
  });

  it("passes malformed input through unchanged", () => {
    expect(formatFriendlyClassDate("not-a-date", now)).toBe("not-a-date");
  });
});
