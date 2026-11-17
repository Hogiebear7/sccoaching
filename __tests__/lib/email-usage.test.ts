import { describe, expect, it } from "vitest";

import { emailLimitsFromEnv, usageAlertsFor, usageWindows } from "@/lib/email-usage";

const now = new Date("2026-11-17T15:30:00Z");
const limits = { daily: 100, monthly: 3000 };

describe("email usage alerts", () => {
  it("says nothing below 80%", () => {
    expect(usageAlertsFor({ day: 79, month: 2399 }, limits, now)).toEqual([]);
  });
  it("alerts on the daily cap at 80 and the monthly cap at 2,400, once per window key", () => {
    const a = usageAlertsFor({ day: 80, month: 2400 }, limits, now);
    expect(a.map((x) => x.scope)).toEqual(["daily", "monthly"]);
    expect(a[0].key).toBe("email-usage-daily:2026-11-17");
    expect(a[1].key).toBe("email-usage-monthly:2026-11");
  });
  it("still reports when over the cap", () => {
    expect(usageAlertsFor({ day: 130, month: 10 }, limits, now).map((x) => x.scope)).toEqual(["daily"]);
  });
  it("uses UTC day and month windows", () => {
    expect(usageWindows(now)).toMatchObject({ dayStart: "2026-11-17T00:00:00.000Z", monthStart: "2026-11-01T00:00:00.000Z" });
  });
  it("reads limits from env and ignores junk", () => {
    expect(emailLimitsFromEnv({ EMAIL_DAILY_LIMIT: "1000", EMAIL_MONTHLY_LIMIT: "x" } as never)).toEqual({ daily: 1000, monthly: 3000 });
    expect(emailLimitsFromEnv({} as never)).toEqual({ daily: 100, monthly: 3000 });
  });
});
