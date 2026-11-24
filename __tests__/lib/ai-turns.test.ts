import { describe, expect, it } from "vitest";

import { CHAT_DATES_RULE, messageStamp, stampTurns, todayLine } from "@/lib/ai-turns";

// 24 Nov 2026 is a Tuesday; Dublin is on GMT in winter.
const NOW = new Date("2026-11-24T10:37:00Z");

describe("ai chat dates", () => {
  it("stamps a message from today, yesterday and weeks ago with its Irish date", () => {
    expect(messageStamp(new Date("2026-11-24T09:05:00Z"), NOW)).toBe("[Tue 24 Nov 2026, 09:05 · today]");
    expect(messageStamp(new Date("2026-11-23T23:47:00Z"), NOW)).toBe("[Mon 23 Nov 2026, 23:47 · yesterday]");
    expect(messageStamp(new Date("2026-10-22T12:00:00Z"), NOW)).toBe("[Thu 22 Oct 2026, 13:00 · 33 days ago]");
  });

  it("uses the Irish date in summer, not UTC (23:30 UTC on 30 June is 00:30 on 1 July)", () => {
    const now = new Date("2026-07-01T10:00:00Z");
    expect(messageStamp(new Date("2026-06-30T23:30:00Z"), now)).toBe("[Wed 1 Jul 2026, 00:30 · today]");
  });

  it("prefixes every turn that has a date and leaves others unchanged", () => {
    const out = stampTurns(
      [
        { role: "assistant", content: "Readiness 71.", createdAt: "2026-10-22T12:00:00Z" },
        { role: "user", content: "Workout please", createdAt: "2026-11-24T11:06:00Z" },
        { role: "user", content: "No date" },
        { role: "user", content: "Bad date", createdAt: "not a date" },
      ],
      NOW,
    );
    expect(out[0]).toEqual({ role: "assistant", content: "[Thu 22 Oct 2026, 13:00 · 33 days ago] Readiness 71." });
    expect(out[1].content).toBe("[Tue 24 Nov 2026, 11:06 · today] Workout please");
    expect(out[2]).toEqual({ role: "user", content: "No date" });
    expect(out[3]).toEqual({ role: "user", content: "Bad date" });
  });

  it("gives today's date and a rule against reusing earlier days' figures", () => {
    expect(todayLine(NOW)).toBe("Today is Tue 24 Nov 2026, 10:37 (Irish time).");
    expect(CHAT_DATES_RULE).toMatch(/Never write one in your own replies/);
    expect(CHAT_DATES_RULE).toMatch(/only true for that day/);
  });
});
