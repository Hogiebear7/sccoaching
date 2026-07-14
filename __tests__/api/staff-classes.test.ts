import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const { mockFindUserById, mockFindClassById, mockSaveClass, mockFindClassCategories, mockIssueWaitlistOffer } = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindClassById: vi.fn(),
  mockSaveClass: vi.fn(),
  mockFindClassCategories: vi.fn(),
  mockIssueWaitlistOffer: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findClassById: mockFindClassById,
  saveClass: mockSaveClass,
  findClassCategories: mockFindClassCategories,
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

  it("repeatWeeks creates one class per week on the same weekday and time", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindClassById.mockReturnValue(undefined);
    const cookie = signSession({ userId: STAFF_USER.id });

    const res = await callStaffClasses(
      {
        title: "Weekly Strength",
        category: "strength",
        date: FUTURE_DATE,
        startTime: "18:00",
        durationMins: "60",
        capacity: "10",
        repeatWeeks: "4",
      },
      cookie
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toBe("Created 4 weekly classes.");
    expect(mockSaveClass).toHaveBeenCalledTimes(4);

    const savedDates = mockSaveClass.mock.calls.map((c) => c[0].date);
    const first = new Date(`${FUTURE_DATE}T00:00:00`);
    for (let week = 0; week < 4; week++) {
      const expected = new Date(first);
      expected.setDate(first.getDate() + week * 7);
      const y = expected.getFullYear();
      const m = String(expected.getMonth() + 1).padStart(2, "0");
      const d = String(expected.getDate()).padStart(2, "0");
      expect(savedDates[week]).toBe(`${y}-${m}-${d}`);
    }

    // Distinct ids, same everything else.
    const ids = new Set(mockSaveClass.mock.calls.map((c) => c[0].id));
    expect(ids.size).toBe(4);
    for (const call of mockSaveClass.mock.calls) {
      expect(call[0].startTime).toBe("18:00");
      expect(call[0].capacity).toBe(10);
    }
  });

  it("rejects out-of-range repeatWeeks with 400", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindClassById.mockReturnValue(undefined);
    const cookie = signSession({ userId: STAFF_USER.id });

    for (const repeatWeeks of ["0", "13", "2.5", "abc"]) {
      const res = await callStaffClasses(
        {
          title: "Weekly Strength",
          category: "strength",
          date: FUTURE_DATE,
          startTime: "18:00",
          durationMins: "60",
          capacity: "10",
          repeatWeeks,
        },
        cookie
      );
      expect(res.status).toBe(400);
    }
    expect(mockSaveClass).not.toHaveBeenCalled();
  });

  it("ignores repeatWeeks when editing an existing class", async () => {
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
        repeatWeeks: "6",
      },
      cookie
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toBe("Class updated.");
    expect(mockSaveClass).toHaveBeenCalledTimes(1);
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
