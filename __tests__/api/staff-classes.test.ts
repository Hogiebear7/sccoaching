import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const { mockFindUserById, mockFindClassById, mockSaveClass, mockFindClassCategories, mockIssueWaitlistOffer, mockFindClassSeriesById, mockSaveClassSeries, mockGenerateOccurrences } = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindClassById: vi.fn(),
  mockSaveClass: vi.fn(),
  mockFindClassCategories: vi.fn(),
  mockIssueWaitlistOffer: vi.fn(),
  mockFindClassSeriesById: vi.fn(),
  mockSaveClassSeries: vi.fn(),
  mockGenerateOccurrences: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findClassById: mockFindClassById,
  saveClass: mockSaveClass,
  findClassCategories: mockFindClassCategories,
  findClassSeriesById: mockFindClassSeriesById,
  saveClassSeries: mockSaveClassSeries,
}));

vi.mock("@/lib/class-series", () => ({
  generateOccurrencesForSeries: mockGenerateOccurrences,
}));

vi.mock("@/lib/scheduling", () => ({
  issueWaitlistOffer: mockIssueWaitlistOffer,
}));

const STAFF_USER = { id: "staff-1", email: "coach@example.com", role: "staff" as const };
const MEMBER_USER = { id: "member-1", email: "member@example.com", role: "member" as const };

function futureDateString(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

const FUTURE_DATE = futureDateString(5);
const LATER_FUTURE_DATE = futureDateString(6);

const EXISTING_CLASS = {
  id: "class-1",
  title: "Old Class",
  category: "general",
  coachUserId: "staff-1",
  date: FUTURE_DATE,
  startTime: "18:00",
  durationMins: 60,
  capacity: 10,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function callStaffClasses(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/staff/classes/route");
  const request = new NextRequest("http://localhost/api/staff/classes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/staff/classes", () => {
  beforeEach(() => {
    mockFindUserById.mockReset();
    mockFindClassById.mockReset();
    mockSaveClass.mockReset();
    mockFindClassCategories.mockReset();
    mockIssueWaitlistOffer.mockReset();
    mockFindClassSeriesById.mockReset();
    mockSaveClassSeries.mockReset();
    mockGenerateOccurrences.mockReset();
    mockGenerateOccurrences.mockReturnValue(12);
    mockFindClassCategories.mockReturnValue([
      { slug: "general", name: "General" },
      { slug: "strength", name: "Strength" },
      { slug: "cardio", name: "Cardio" },
      { slug: "mother_and_baby", name: "Mother & Baby" },
    ]);
  });

  it("rejects requests with no session cookie", async () => {
    const res = await callStaffClasses({ title: "New Class" });

    expect(res.status).toBe(401);
    expect(mockSaveClass).not.toHaveBeenCalled();
  });

  it("rejects a member session with 403", async () => {
    mockFindUserById.mockReturnValue(MEMBER_USER);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callStaffClasses(
      {
        title: "New Class",
        category: "general",
        date: FUTURE_DATE,
        startTime: "18:00",
        durationMins: "60",
        capacity: "10",
      },
      cookie
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.message).toBe("Only staff can manage classes.");
    expect(mockSaveClass).not.toHaveBeenCalled();
  });

  it("rejects a missing class name with 400", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    const cookie = signSession({ userId: STAFF_USER.id });

    const res = await callStaffClasses(
      { title: "", category: "general", date: FUTURE_DATE, startTime: "18:00", durationMins: "60", capacity: "10" },
      cookie
    );

    expect(res.status).toBe(400);
    expect(mockSaveClass).not.toHaveBeenCalled();
  });

  it("rejects an invalid class category with 400", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    const cookie = signSession({ userId: STAFF_USER.id });

    const res = await callStaffClasses(
      {
        title: "New Class",
        category: "yoga",
        date: FUTURE_DATE,
        startTime: "18:00",
        durationMins: "60",
        capacity: "10",
      },
      cookie
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.message).toBe("A valid class category is required.");
    expect(mockSaveClass).not.toHaveBeenCalled();
  });

  it("rejects a past date/time with 400", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    const cookie = signSession({ userId: STAFF_USER.id });

    const res = await callStaffClasses(
      {
        title: "New Class",
        category: "general",
        date: "2020-01-01",
        startTime: "09:00",
        durationMins: "60",
        capacity: "10",
      },
      cookie
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.message).toBe("Class date and time must be in the future.");
    expect(mockSaveClass).not.toHaveBeenCalled();
  });

  it("rejects a non-positive duration with 400", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    const cookie = signSession({ userId: STAFF_USER.id });

    const res = await callStaffClasses(
      {
        title: "New Class",
        category: "general",
        date: FUTURE_DATE,
        startTime: "18:00",
        durationMins: "0",
        capacity: "10",
      },
      cookie
    );

    expect(res.status).toBe(400);
    expect(mockSaveClass).not.toHaveBeenCalled();
  });

  it("rejects a non-positive capacity with 400", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    const cookie = signSession({ userId: STAFF_USER.id });

    const res = await callStaffClasses(
      {
        title: "New Class",
        category: "general",
        date: FUTURE_DATE,
        startTime: "18:00",
        durationMins: "60",
        capacity: "-1",
      },
      cookie
    );

    expect(res.status).toBe(400);
    expect(mockSaveClass).not.toHaveBeenCalled();
  });

  it("creates a new class with the creating staff member as coach", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindClassById.mockReturnValue(undefined);
    const cookie = signSession({ userId: STAFF_USER.id });

    const res = await callStaffClasses(
      {
        title: "New Class",
        category: "mother_and_baby",
        date: FUTURE_DATE,
        startTime: "18:00",
        durationMins: "60",
        capacity: "10",
      },
      cookie
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toBe("Class created.");

    const saved = mockSaveClass.mock.calls[0][0];
    expect(saved.coachUserId).toBe(STAFF_USER.id);
    expect(saved.title).toBe("New Class");
    expect(saved.category).toBe("mother_and_baby");
    expect(saved.durationMins).toBe(60);
    expect(saved.capacity).toBe(10);
    expect(saved.id).toBeTruthy();
    expect(saved.createdAt).toBe(saved.updatedAt);
    expect(mockIssueWaitlistOffer).not.toHaveBeenCalled();
  });

  // Regression test: the mobile app's class editor sends durationMins/
  // capacity as real numbers (correct for a JSON API client), not strings
  // like the web form's inputs — parseRequiredPositiveInt previously only
  // accepted strings, so every mobile-created class was rejected with
  // "Duration must be a whole number greater than zero" regardless of the
  // actual value.
  it("accepts durationMins/capacity sent as real numbers, not just strings", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindClassById.mockReturnValue(undefined);
    const cookie = signSession({ userId: STAFF_USER.id });

    const res = await callStaffClasses(
      {
        title: "Mobile-created Class",
        category: "general",
        date: FUTURE_DATE,
        startTime: "18:00",
        durationMins: 45,
        capacity: 8,
      },
      cookie
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toBe("Class created.");
    const saved = mockSaveClass.mock.calls[0][0];
    expect(saved.durationMins).toBe(45);
    expect(saved.capacity).toBe(8);
  });

  it("updates an existing class, preserving id, coachUserId, and createdAt", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindClassById.mockReturnValue(EXISTING_CLASS);
    const cookie = signSession({ userId: STAFF_USER.id });

    const res = await callStaffClasses(
      {
        id: "class-1",
        title: "Updated Class",
        category: "strength",
        date: LATER_FUTURE_DATE,
        startTime: "19:00",
        durationMins: "45",
        capacity: "8",
      },
      cookie
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toBe("Class updated.");

    const saved = mockSaveClass.mock.calls[0][0];
    expect(saved.id).toBe(EXISTING_CLASS.id);
    expect(saved.coachUserId).toBe(EXISTING_CLASS.coachUserId);
    expect(saved.createdAt).toBe(EXISTING_CLASS.createdAt);
    expect(saved.title).toBe("Updated Class");
    expect(saved.capacity).toBe(8);
    expect(saved.updatedAt).not.toBe(EXISTING_CLASS.updatedAt);
    // Capacity went down (10 -> 8), not up, so no promotion should fire.
    expect(mockIssueWaitlistOffer).not.toHaveBeenCalled();
  });

  it("repeat=weekly creates a series and generates occurrences", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindClassById.mockReturnValue(undefined);
    const cookie = signSession({ userId: STAFF_USER.id });

    const res = await callStaffClasses(
      {
        title: "MWF Strength",
        category: "strength",
        date: FUTURE_DATE,
        startTime: "07:00",
        durationMins: "60",
        capacity: "10",
        repeat: "weekly",
        weekdays: [1, 3, 5],
      },
      cookie
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toContain("Repeating class created");
    expect(data.message).toContain("added automatically");

    const series = mockSaveClassSeries.mock.calls[0][0];
    expect(series).toMatchObject({
      title: "MWF Strength",
      weekdays: [1, 3, 5],
      startDate: FUTURE_DATE,
      endDate: null,
      skippedDates: [],
      isActive: true,
      coachUserId: STAFF_USER.id,
    });
    expect(mockGenerateOccurrences).toHaveBeenCalledWith(series);
    // The series generates the occurrences — no direct class writes here.
    expect(mockSaveClass).not.toHaveBeenCalled();
  });

  it("bounded weekly repeat stores the end date and mentions it", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindClassById.mockReturnValue(undefined);
    const cookie = signSession({ userId: STAFF_USER.id });

    const res = await callStaffClasses(
      {
        title: "Summer Block",
        category: "strength",
        date: FUTURE_DATE,
        startTime: "07:00",
        durationMins: "60",
        capacity: "10",
        repeat: "weekly",
        weekdays: [2, 4],
        repeatEndDate: LATER_FUTURE_DATE,
      },
      cookie
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toContain(`repeats until ${LATER_FUTURE_DATE}`);
    expect(mockSaveClassSeries.mock.calls[0][0].endDate).toBe(LATER_FUTURE_DATE);
  });

  it("rejects weekly repeats with no weekdays, bad weekday values, or an end before the start", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindClassById.mockReturnValue(undefined);
    const cookie = signSession({ userId: STAFF_USER.id });

    const base = {
      title: "Bad Series",
      category: "strength",
      date: LATER_FUTURE_DATE,
      startTime: "07:00",
      durationMins: "60",
      capacity: "10",
      repeat: "weekly",
    };

    for (const body of [
      { ...base, weekdays: [] },
      { ...base, weekdays: [7] },
      { ...base, weekdays: [1.5] },
      { ...base, weekdays: "monday" },
      { ...base, weekdays: [1], repeatEndDate: FUTURE_DATE }, // ends before start
    ]) {
      const res = await callStaffClasses(body, cookie);
      expect(res.status).toBe(400);
    }
    expect(mockSaveClassSeries).not.toHaveBeenCalled();
    expect(mockSaveClass).not.toHaveBeenCalled();
  });

  it("moving a series occurrence to a new date tombstones the old date", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindClassById.mockReturnValue({ ...EXISTING_CLASS, seriesId: "series-1" });
    mockFindClassSeriesById.mockReturnValue({
      id: "series-1",
      skippedDates: [],
    });
    const cookie = signSession({ userId: STAFF_USER.id });

    const res = await callStaffClasses(
      {
        id: "class-1",
        title: "Old Class",
        category: "general",
        date: LATER_FUTURE_DATE, // moved from FUTURE_DATE
        startTime: "18:00",
        durationMins: "60",
        capacity: "10",
      },
      cookie
    );

    expect(res.status).toBe(200);
    expect(mockSaveClassSeries.mock.calls[0][0].skippedDates).toContain(FUTURE_DATE);
    // Occurrence itself saved with the new date, series link intact.
    expect(mockSaveClass.mock.calls[0][0]).toMatchObject({
      date: LATER_FUTURE_DATE,
      seriesId: "series-1",
    });
  });

  it("editing a series occurrence without a date change leaves the series alone", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindClassById.mockReturnValue({ ...EXISTING_CLASS, seriesId: "series-1" });
    const cookie = signSession({ userId: STAFF_USER.id });

    const res = await callStaffClasses(
      {
        id: "class-1",
        title: "Renamed Occurrence",
        category: "general",
        date: FUTURE_DATE, // unchanged
        startTime: "18:00",
        durationMins: "60",
        capacity: "10",
      },
      cookie
    );

    expect(res.status).toBe(200);
    expect(mockSaveClassSeries).not.toHaveBeenCalled();
  });

  it("attempts waitlist promotion when capacity is raised on an existing class", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindClassById.mockReturnValue(EXISTING_CLASS);
    const cookie = signSession({ userId: STAFF_USER.id });

    const res = await callStaffClasses(
      {
        id: "class-1",
        title: EXISTING_CLASS.title,
        category: "general",
        date: FUTURE_DATE,
        startTime: "18:00",
        durationMins: "60",
        capacity: "12",
      },
      cookie
    );

    expect(res.status).toBe(200);
    expect(mockIssueWaitlistOffer).toHaveBeenCalledWith("class-1");
  });
});
