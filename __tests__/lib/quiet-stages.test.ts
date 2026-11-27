import { describe, expect, it } from "vitest";
import { daysQuiet, isQuietAtLeast, QUIET_STAGES } from "@/lib/quiet-stages";

const now = new Date("2026-11-27T12:00:00Z");

describe("quiet stages", () => {
  it("counts whole days", () => {
    expect(daysQuiet("2026-11-27", now)).toBe(0);
    expect(daysQuiet("2026-11-17", now)).toBe(10);
    expect(daysQuiet("2026-11-17T09:00:00Z", now)).toBe(10);
  });
  it("returns null for no or bad date", () => {
    expect(daysQuiet(null, now)).toBeNull();
    expect(daysQuiet("nonsense", now)).toBeNull();
  });
  it("never counts a future date as negative", () => {
    expect(daysQuiet("2026-12-05", now)).toBe(0);
  });
  it("stage boundaries are inclusive", () => {
    expect(isQuietAtLeast("2026-11-17", 10, now)).toBe(true);
    expect(isQuietAtLeast("2026-11-18", 10, now)).toBe(false);
    expect(isQuietAtLeast(null, 10, now)).toBe(false);
  });
  it("stages ascend", () => {
    const days = QUIET_STAGES.map((s) => s.minDays);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });
});
