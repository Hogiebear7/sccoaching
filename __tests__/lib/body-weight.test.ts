import { describe, expect, it } from "vitest";

import type { BodyWeightLogRecord } from "@/lib/db";
import { latestWeightLog, resolveCurrentWeightKg } from "@/lib/body-weight";

function log(date: string, weightKg: number, createdAt = `${date}T08:00:00.000Z`): BodyWeightLogRecord {
  return { id: `log-${date}-${createdAt}`, userId: "user-1", date, weightKg, createdAt };
}

describe("latestWeightLog", () => {
  it("returns null with no logs", () => {
    expect(latestWeightLog([])).toBeNull();
  });

  it("picks the newest entry by date regardless of input order", () => {
    const logs = [log("2026-07-01", 80), log("2026-07-05", 78.5), log("2026-07-03", 79)];
    expect(latestWeightLog(logs)?.weightKg).toBe(78.5);
  });

  it("tie-breaks same-date entries by createdAt", () => {
    const logs = [
      log("2026-07-05", 79, "2026-07-05T07:00:00.000Z"),
      log("2026-07-05", 78, "2026-07-05T20:00:00.000Z"),
    ];
    expect(latestWeightLog(logs)?.weightKg).toBe(78);
  });
});

describe("resolveCurrentWeightKg", () => {
  it("prefers the latest log over the profile field (single source of truth)", () => {
    expect(resolveCurrentWeightKg(82, [log("2026-07-05", 78.5)])).toBe(78.5);
  });

  it("falls back to the profile field when there are no logs", () => {
    expect(resolveCurrentWeightKg(82, [])).toBe(82);
  });

  it("returns null only when neither source has a value", () => {
    expect(resolveCurrentWeightKg(null, [])).toBeNull();
  });

  it("a backdated log never overrides a newer weight", () => {
    const logs = [log("2026-07-05", 78.5), log("2026-06-01", 84)];
    expect(resolveCurrentWeightKg(null, logs)).toBe(78.5);
  });

  it("logging a new latest entry becomes the current weight (drives Profile, Nutrition, AI)", () => {
    const existing = [log("2026-07-01", 80)];
    expect(resolveCurrentWeightKg(82, existing)).toBe(80);

    // The member logs a newer entry — every resolver-backed surface flips.
    const afterLogging = [...existing, log("2026-07-06", 78)];
    expect(resolveCurrentWeightKg(82, afterLogging)).toBe(78);
  });
});
