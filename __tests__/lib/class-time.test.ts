import { describe, expect, it } from "vitest";

import { classStartMs, currentHourInGymTimeZone } from "@/lib/class-time";

// These assertions are checked against known-correct absolute UTC instants
// so they hold regardless of what timezone the test runner itself happens
// to be in — unlike the old `new Date(...).setHours(...)` call sites this
// replaces, which were only ever "accidentally correct" locally because
// dev machines here happen to already be set to Europe/Dublin.
describe("classStartMs", () => {
  it("computes the correct UTC instant during BST (summer, UTC+1)", () => {
    // 07:00 Dublin in August is 06:00 UTC.
    expect(classStartMs("2026-08-17", "07:00")).toBe(Date.UTC(2026, 7, 17, 6, 0, 0));
  });

  it("computes the correct UTC instant during GMT (winter, UTC+0)", () => {
    // 07:00 Dublin in January is 07:00 UTC — no offset.
    expect(classStartMs("2026-01-17", "07:00")).toBe(Date.UTC(2026, 0, 17, 7, 0, 0));
  });

  it("handles a class time that crosses a UTC day boundary", () => {
    // 00:30 Dublin in August (BST) is 23:30 UTC the PREVIOUS day.
    expect(classStartMs("2026-08-17", "00:30")).toBe(Date.UTC(2026, 7, 16, 23, 30, 0));
  });

  it("is correct either side of the actual BST/GMT clock-change weekend", () => {
    // Clocks went forward on 2026-03-29 (spring forward, 01:00 -> 02:00).
    // The day before is still GMT (UTC+0); the day after is BST (UTC+1).
    expect(classStartMs("2026-03-28", "07:00")).toBe(Date.UTC(2026, 2, 28, 7, 0, 0));
    expect(classStartMs("2026-03-30", "07:00")).toBe(Date.UTC(2026, 2, 30, 6, 0, 0));
  });
});

describe("currentHourInGymTimeZone", () => {
  it("reads the hour in Dublin time, not the instant's raw UTC hour", () => {
    // 2026-08-17T23:30:00Z is 00:30 the next day in Dublin (BST, UTC+1).
    const at = new Date(Date.UTC(2026, 7, 17, 23, 30, 0));
    expect(currentHourInGymTimeZone(at)).toBe(0);
  });

  it("matches the UTC hour directly during GMT", () => {
    const at = new Date(Date.UTC(2026, 0, 17, 14, 0, 0));
    expect(currentHourInGymTimeZone(at)).toBe(14);
  });
});
