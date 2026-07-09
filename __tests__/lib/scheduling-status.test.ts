import { describe, expect, it } from "vitest";

import {
  classPassBalance,
  extraSessionsGranted,
  formatRemainingSessions,
  formatSessionAllowance,
  isClassEligibleForPlan,
  isFutureDateTime,
  remainingSessions,
} from "@/lib/scheduling-status";

function grant(amount: number) {
  return {
    id: `grant-${amount}-${Math.random()}`,
    amount,
    note: null,
    grantedByUserId: "staff-1",
    createdAt: "2026-07-01T10:00:00.000Z",
  };
}

describe("isFutureDateTime", () => {
  it("returns true for a date/time in the future", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const date = future.toISOString().slice(0, 10);
    expect(isFutureDateTime(date, "12:00")).toBe(true);
  });

  it("returns false for a date/time in the past", () => {
    expect(isFutureDateTime("2020-01-01", "09:00")).toBe(false);
  });

  it("returns false for an unparseable date/time", () => {
    expect(isFutureDateTime("not-a-date", "not-a-time")).toBe(false);
  });
});

describe("isClassEligibleForPlan", () => {
  it("allows any category when the plan has no restrictions", () => {
    expect(isClassEligibleForPlan("mother_and_baby", { allowedCategories: [] })).toBe(true);
  });

  it("allows a category included in the plan's list", () => {
    expect(isClassEligibleForPlan("strength", { allowedCategories: ["general", "strength"] })).toBe(true);
  });

  it("rejects a category not included in the plan's list", () => {
    expect(isClassEligibleForPlan("mother_and_baby", { allowedCategories: ["general", "strength"] })).toBe(
      false
    );
  });
});

describe("remainingSessions", () => {
  it("returns null for an unlimited plan", () => {
    expect(
      remainingSessions(
        { monthlySessionAllowance: null },
        { sessionsUsedThisPeriod: 50, extraSessionGrants: [] }
      )
    ).toBeNull();
  });

  it("returns the difference between allowance and usage", () => {
    expect(
      remainingSessions(
        { monthlySessionAllowance: 8 },
        { sessionsUsedThisPeriod: 3, extraSessionGrants: [] }
      )
    ).toBe(5);
  });

  it("never returns negative", () => {
    expect(
      remainingSessions(
        { monthlySessionAllowance: 8 },
        { sessionsUsedThisPeriod: 12, extraSessionGrants: [] }
      )
    ).toBe(0);
  });

  it("adds staff-granted extra passes onto the allowance", () => {
    expect(
      remainingSessions(
        { monthlySessionAllowance: 8 },
        { sessionsUsedThisPeriod: 8, extraSessionGrants: [grant(2), grant(1)] }
      )
    ).toBe(3);
  });
});

describe("extraSessionsGranted", () => {
  it("returns 0 when no grants exist", () => {
    expect(extraSessionsGranted({ extraSessionGrants: [] })).toBe(0);
  });

  it("sums grant amounts", () => {
    expect(extraSessionsGranted({ extraSessionGrants: [grant(2), grant(3)] })).toBe(5);
  });
});

describe("classPassBalance", () => {
  it("computes included − used + extra = remaining", () => {
    expect(
      classPassBalance(
        { monthlySessionAllowance: 8 },
        { sessionsUsedThisPeriod: 5, extraSessionGrants: [grant(2)] }
      )
    ).toEqual({ allowance: 8, used: 5, extra: 2, remaining: 5, overusedBy: 0 });
  });

  it("reports unlimited plans with a null remaining", () => {
    expect(
      classPassBalance(
        { monthlySessionAllowance: null },
        { sessionsUsedThisPeriod: 12, extraSessionGrants: [grant(2)] }
      )
    ).toEqual({ allowance: null, used: 12, extra: 2, remaining: null, overusedBy: 0 });
  });

  it("clamps remaining at 0 and reports overuse separately", () => {
    expect(
      classPassBalance(
        { monthlySessionAllowance: 4 },
        { sessionsUsedThisPeriod: 7, extraSessionGrants: [grant(1)] }
      )
    ).toEqual({ allowance: 4, used: 7, extra: 1, remaining: 0, overusedBy: 2 });
  });

  it("handles a zero-usage period", () => {
    expect(
      classPassBalance(
        { monthlySessionAllowance: 8 },
        { sessionsUsedThisPeriod: 0, extraSessionGrants: [] }
      )
    ).toEqual({ allowance: 8, used: 0, extra: 0, remaining: 8, overusedBy: 0 });
  });
});

describe("formatRemainingSessions / formatSessionAllowance", () => {
  it("formats unlimited", () => {
    expect(formatRemainingSessions(null)).toBe("Unlimited");
    expect(formatSessionAllowance(null)).toBe("Unlimited");
  });

  it("formats singular vs plural sessions remaining", () => {
    expect(formatRemainingSessions(1)).toBe("1 session left");
    expect(formatRemainingSessions(5)).toBe("5 sessions left");
  });

  it("formats the monthly allowance", () => {
    expect(formatSessionAllowance(8)).toBe("8 sessions / month");
    expect(formatSessionAllowance(1)).toBe("1 session / month");
  });
});
