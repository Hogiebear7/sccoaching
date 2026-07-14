import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindClassBySeriesAndDate, mockFindClassSeries, mockSaveClass } = vi.hoisted(() => ({
  mockFindClassBySeriesAndDate: vi.fn(),
  mockFindClassSeries: vi.fn(),
  mockSaveClass: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findClassBySeriesAndDate: mockFindClassBySeriesAndDate,
  findClassSeries: mockFindClassSeries,
  saveClass: mockSaveClass,
}));

import {
  SERIES_HORIZON_DAYS,
  ensureSeriesOccurrences,
  generateOccurrencesForSeries,
} from "@/lib/class-series";

// Fixed "now": Wednesday 15 July 2026, mid-morning local time.
const NOW = new Date(2026, 6, 15, 10, 0, 0);

const SERIES = {
  id: "series-1",
  title: "Morning Strength",
  category: "strength",
  coachUserId: "staff-1",
  weekdays: [1, 3, 5], // Mon, Wed, Fri
  startTime: "07:00",
  durationMins: 60,
  capacity: 10,
  startDate: "2026-07-15",
  endDate: null as string | null,
  skippedDates: [] as string[],
  isActive: true,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("generateOccurrencesForSeries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindClassBySeriesAndDate.mockReturnValue(undefined);
  });

  it("creates one occurrence per selected weekday within the horizon and no more", () => {
    const created = generateOccurrencesForSeries(SERIES, NOW);

    const dates = mockSaveClass.mock.calls.map((c) => c[0].date);
    // 15 Jul 2026 is a Wednesday; horizon = 28 days → expect Mon/Wed/Fri only.
    expect(dates[0]).toBe("2026-07-15");
    expect(dates).toContain("2026-07-17"); // Friday
    expect(dates).toContain("2026-07-20"); // Monday
    expect(dates).not.toContain("2026-07-16"); // Thursday — not selected
    expect(dates).not.toContain("2026-07-19"); // Sunday — not selected

    // Every generated date is within the horizon.
    const horizonEnd = new Date(2026, 6, 15 + SERIES_HORIZON_DAYS);
    for (const d of dates) {
      const [y, m, day] = d.split("-").map(Number);
      expect(new Date(y, m - 1, day).getTime()).toBeLessThanOrEqual(horizonEnd.getTime());
    }
    expect(created).toBe(dates.length);
    expect(created).toBeGreaterThanOrEqual(12); // 3 days/week × 4 weeks
    expect(created).toBeLessThanOrEqual(13);

    // Occurrences carry the series stamp and its settings.
    expect(mockSaveClass.mock.calls[0][0]).toMatchObject({
      seriesId: "series-1",
      title: "Morning Strength",
      startTime: "07:00",
      capacity: 10,
    });
  });

  it("re-running creates nothing when occurrences already exist", () => {
    mockFindClassBySeriesAndDate.mockImplementation(() => ({ id: "existing" }));
    const created = generateOccurrencesForSeries(SERIES, NOW);
    expect(created).toBe(0);
    expect(mockSaveClass).not.toHaveBeenCalled();
  });

  it("never regenerates tombstoned dates", () => {
    const created = generateOccurrencesForSeries(
      { ...SERIES, skippedDates: ["2026-07-17", "2026-07-20"] },
      NOW
    );
    const dates = mockSaveClass.mock.calls.map((c) => c[0].date);
    expect(dates).not.toContain("2026-07-17");
    expect(dates).not.toContain("2026-07-20");
    expect(created).toBe(dates.length);
  });

  it("respects the end date and the start date", () => {
    generateOccurrencesForSeries({ ...SERIES, endDate: "2026-07-20" }, NOW);
    const dates = mockSaveClass.mock.calls.map((c) => c[0].date);
    expect(dates).toEqual(["2026-07-15", "2026-07-17", "2026-07-20"]);

    mockSaveClass.mockClear();
    generateOccurrencesForSeries({ ...SERIES, startDate: "2026-07-20" }, NOW);
    const dates2 = mockSaveClass.mock.calls.map((c) => c[0].date);
    expect(dates2[0]).toBe("2026-07-20");
    expect(dates2).not.toContain("2026-07-15");
    expect(dates2).not.toContain("2026-07-17");
  });

  it("generates nothing for a stopped series or one whose end has passed", () => {
    expect(generateOccurrencesForSeries({ ...SERIES, isActive: false }, NOW)).toBe(0);
    expect(generateOccurrencesForSeries({ ...SERIES, endDate: "2026-07-01" }, NOW)).toBe(0);
    expect(mockSaveClass).not.toHaveBeenCalled();
  });

  it("ensureSeriesOccurrences tops up every active series", () => {
    mockFindClassSeries.mockReturnValue([
      SERIES,
      { ...SERIES, id: "series-2", weekdays: [2] }, // Tuesdays
      { ...SERIES, id: "series-3", isActive: false },
    ]);

    const created = ensureSeriesOccurrences(NOW);

    const bySeries = new Map<string, number>();
    for (const call of mockSaveClass.mock.calls) {
      bySeries.set(call[0].seriesId, (bySeries.get(call[0].seriesId) ?? 0) + 1);
    }
    expect(bySeries.get("series-1")).toBeGreaterThanOrEqual(12);
    expect(bySeries.get("series-2")).toBeGreaterThanOrEqual(4);
    expect(bySeries.has("series-3")).toBe(false);
    expect(created).toBe(mockSaveClass.mock.calls.length);
  });
});
