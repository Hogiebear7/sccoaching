import { describe, expect, it } from "vitest";

import type { RecoveryLogRecord } from "@/lib/db";
import {
  intensityMix,
  isoWeekNumber,
  mondayOf,
  readinessDelta,
  readinessSeries,
  sparklineSegments,
  weeklyTrainingSummary,
} from "@/lib/progress";

function log(
  date: string,
  overrides: Partial<RecoveryLogRecord> = {}
): RecoveryLogRecord {
  return {
    id: `rec-${date}`,
    userId: "user-1",
    date,
    sleepHours: 7,
    sleepQuality: 4,
    soreness: 2,
    fatigue: 2,
    trainingDurationMins: 60,
    rpe: 7,
    goal: null,
    notes: null,
    readinessScore: 80,
    createdAt: `${date}T08:00:00.000Z`,
    updatedAt: `${date}T08:00:00.000Z`,
    ...overrides,
  };
}

// 2026-07-08 is a Wednesday; its ISO week starts Monday 2026-07-06.
const TODAY = "2026-07-08";

describe("mondayOf / isoWeekNumber", () => {
  it("finds the Monday of the containing week", () => {
    expect(mondayOf("2026-07-08")).toBe("2026-07-06"); // Wed → Mon
    expect(mondayOf("2026-07-06")).toBe("2026-07-06"); // Mon → itself
    expect(mondayOf("2026-07-12")).toBe("2026-07-06"); // Sun → prior Mon
  });

  it("computes ISO week numbers", () => {
    expect(isoWeekNumber("2026-01-01")).toBe(1);
    expect(isoWeekNumber("2026-07-08")).toBe(28);
  });
});

describe("readinessSeries", () => {
  it("returns one slot per day, oldest first, with gaps as null", () => {
    const series = readinessSeries(
      [log(TODAY, { readinessScore: 82 }), log("2026-07-06", { readinessScore: 70 })],
      TODAY,
      3
    );
    expect(series).toEqual([70, null, 82]);
  });
});

describe("readinessDelta", () => {
  it("compares today with the most recent earlier score", () => {
    const logs = [
      log(TODAY, { readinessScore: 82 }),
      log("2026-07-05", { readinessScore: 76 }),
      log("2026-07-01", { readinessScore: 90 }),
    ];
    expect(readinessDelta(logs, TODAY)).toBe(6);
  });

  it("returns null when today or history is missing", () => {
    expect(readinessDelta([log("2026-07-05")], TODAY)).toBeNull();
    expect(readinessDelta([log(TODAY)], TODAY)).toBeNull();
  });
});

describe("weeklyTrainingSummary", () => {
  it("buckets loads Mon→Sun and reports week-over-week change", () => {
    const logs = [
      // Current week (starts 2026-07-06): Mon 60×7=420, Wed 30×8=240 → 660
      log("2026-07-06", { trainingDurationMins: 60, rpe: 7 }),
      log("2026-07-08", { trainingDurationMins: 30, rpe: 8 }),
      // Previous week: Tue 100×6=600
      log("2026-06-30", { trainingDurationMins: 100, rpe: 6 }),
    ];
    const weeks = weeklyTrainingSummary(logs, TODAY, 2);

    expect(weeks).toHaveLength(2);
    expect(weeks[0].isCurrentWeek).toBe(true);
    expect(weeks[0].label).toBe("W28");
    expect(weeks[0].totalLoad).toBe(660);
    expect(weeks[0].dayLoads).toEqual([420, null, 240, null, null, null, null]);
    expect(weeks[0].changePct).toBe(10); // 660 vs 600
    expect(weeks[1].totalLoad).toBe(600);
    expect(weeks[1].changePct).toBeNull(); // nothing before it to compare
  });

  it("ignores logs without duration or RPE", () => {
    const weeks = weeklyTrainingSummary(
      [log(TODAY, { trainingDurationMins: null })],
      TODAY,
      1
    );
    expect(weeks[0].totalLoad).toBe(0);
  });
});

describe("intensityMix", () => {
  it("splits load across RPE bands, weighted by load", () => {
    const mix = intensityMix(
      [
        log("2026-07-06", { trainingDurationMins: 100, rpe: 4 }), // easy 400
        log("2026-07-07", { trainingDurationMins: 50, rpe: 6 }), // moderate 300
        log(TODAY, { trainingDurationMins: 30, rpe: 10 }), // hard 300
      ],
      TODAY
    );
    expect(mix).toEqual({ easyPct: 40, moderatePct: 30, hardPct: 30, sessions: 3 });
  });

  it("returns null when nothing in the window has load", () => {
    expect(intensityMix([log(TODAY, { rpe: null })], TODAY)).toBeNull();
    expect(intensityMix([log("2020-01-01")], TODAY)).toBeNull();
  });

  it("percentages always sum to 100", () => {
    const mix = intensityMix(
      [
        log("2026-07-05", { trainingDurationMins: 33, rpe: 4 }),
        log("2026-07-06", { trainingDurationMins: 33, rpe: 7 }),
        log("2026-07-07", { trainingDurationMins: 34, rpe: 9 }),
      ],
      TODAY
    );
    expect(mix!.easyPct + mix!.moderatePct + mix!.hardPct).toBe(100);
  });
});

describe("sparklineSegments", () => {
  it("maps values into points and splits on gaps", () => {
    const segments = sparklineSegments([0, 100, null, 50], 30, 10);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toBe("0,10 10,0");
    expect(segments[1]).toBe("30,5");
  });

  it("returns nothing for empty input", () => {
    expect(sparklineSegments([], 30, 10)).toEqual([]);
  });
});
