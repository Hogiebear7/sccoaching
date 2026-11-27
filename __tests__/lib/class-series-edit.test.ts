import { describe, expect, it } from "vitest";

import { cleanSeriesChanges, planSeriesEdit } from "@/lib/class-series-edit";
import type { ClassRecord, ClassSeriesRecord } from "@/lib/db";

const series = {
  id: "s1",
  title: "Boxing",
  category: "strength",
  coachUserId: "c1",
  weekdays: [1],
  startTime: "18:00",
  durationMins: 45,
  capacity: 12,
  startDate: "2026-01-01",
  endDate: null,
  skippedDates: [],
  isActive: true,
  createdAt: "",
  updatedAt: "",
} as unknown as ClassSeriesRecord;

const cls = (id: string, date: string, seriesId = "s1") => ({ id, seriesId, date, startTime: "18:00", capacity: 12, durationMins: 45, title: "Boxing" }) as unknown as ClassRecord;

const now = Date.parse("2026-11-27T12:00:00Z");
const rows = [cls("past", "2026-11-23"), cls("a", "2026-11-30"), cls("b", "2026-12-07"), cls("other", "2026-12-01", "s2")];

describe("cleanSeriesChanges", () => {
  it("accepts good values and trims", () => {
    expect(cleanSeriesChanges({ title: "  Fight Club ", startTime: "19:30", capacity: "10" }).changes).toEqual({ title: "Fight Club", startTime: "19:30", capacity: 10 });
  });
  it("rejects bad time, spaces and name", () => {
    expect(cleanSeriesChanges({ startTime: "7pm" }).error).toMatch(/18:30/);
    expect(cleanSeriesChanges({ capacity: 0 }).error).toMatch(/Spaces/);
    expect(cleanSeriesChanges({ durationMins: 2.5 }).error).toMatch(/Length/);
    expect(cleanSeriesChanges({ title: " " }).error).toMatch(/name/);
  });
});

describe("planSeriesEdit", () => {
  it("only touches this series upcoming sessions", () => {
    const plan = planSeriesEdit(series, rows, () => 0, { startTime: "19:00" }, now);
    expect(plan.occurrences.map((o) => o.classId)).toEqual(["a", "b"]);
    expect(plan.willChange).toBe(2);
    expect(plan.lines.at(-1)).toMatch(/Past sessions are never changed/);
  });
  it("reports nothing-changed", () => {
    expect(planSeriesEdit(series, rows, () => 0, { startTime: "18:00" }, now).error).toMatch(/Nothing/);
  });
  it("blocks sessions where booked people exceed the new spaces", () => {
    const plan = planSeriesEdit(series, rows, (id) => (id === "a" ? 8 : 2), { capacity: 5 }, now);
    expect(plan.occurrences.find((o) => o.classId === "a")?.blocked).toMatch(/8 people/);
    expect(plan.willChange).toBe(1);
    expect(plan.blocked).toBe(1);
  });
  it("warns that booked members will move when the time changes", () => {
    const plan = planSeriesEdit(series, rows, () => 3, { startTime: "19:00" }, now);
    expect(plan.bookedMembers).toBe(6);
    expect(plan.lines.join(" ")).toMatch(/6 bookings will move/);
  });
  it("handles a series with no upcoming sessions", () => {
    const plan = planSeriesEdit(series, [cls("past", "2026-11-23")], () => 0, { title: "New" }, now);
    expect(plan.lines[0]).toMatch(/no upcoming sessions/);
  });
});
