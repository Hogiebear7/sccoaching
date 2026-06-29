import { describe, expect, it } from "vitest";

import {
  formatRemainingSessions,
  formatSessionAllowance,
  isClassEligibleForPlan,
  isFutureDateTime,
  remainingSessions,
} from "@/lib/scheduling-status";

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
      remainingSessions({ monthlySessionAllowance: null }, { sessionsUsedThisPeriod: 50 })
    ).toBeNull();
  });

  it("returns the difference between allowance and usage", () => {
    expect(
      remainingSessions({ monthlySessionAllowance: 8 }, { sessionsUsedThisPeriod: 3 })
    ).toBe(5);
  });

  it("never returns negative", () => {
    expect(
      remainingSessions({ monthlySessionAllowance: 8 }, { sessionsUsedThisPeriod: 12 })
    ).toBe(0);
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
