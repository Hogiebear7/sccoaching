import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const {
  mockFindUserById,
  mockFindClassById,
  mockFindBookingsByClassId,
  mockFindWorkoutSessionByUserAndClass,
  mockSaveClassWorkout,
  mockSaveWorkoutSession,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindClassById: vi.fn(),
  mockFindBookingsByClassId: vi.fn(),
  mockFindWorkoutSessionByUserAndClass: vi.fn(),
  mockSaveClassWorkout: vi.fn(),
  mockSaveWorkoutSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findClassById: mockFindClassById,
  findBookingsByClassId: mockFindBookingsByClassId,
  findWorkoutSessionByUserAndClass: mockFindWorkoutSessionByUserAndClass,
  saveClassWorkout: mockSaveClassWorkout,
  saveWorkoutSession: mockSaveWorkoutSession,
}));

const STAFF_USER = { id: "staff-1", email: "coach@example.com", role: "staff" as const };
const MEMBER_USER = { id: "member-1", email: "member@example.com", role: "member" as const };

const CLASS = {
  id: "class-1",
  title: "Evening Strength",
  category: "strength",
  coachUserId: "staff-1",
  date: "2026-07-15",
  startTime: "18:00",
  durationMins: 60,
  capacity: 10,
  createdAt: "x",
  updatedAt: "x",
};

const TEMPLATE = [{ name: "Back Squat", weight: "60", reps: 5, sets: 5 }];

async function callWorkout(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/staff/classes/[classId]/workout/route");
  const request = new NextRequest("http://localhost/api/staff/classes/class-1/workout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ classId: "class-1" }) });
}

describe("POST /api/staff/classes/[classId]/workout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindClassById.mockReturnValue(CLASS);
    mockFindBookingsByClassId.mockReturnValue([]);
    mockFindWorkoutSessionByUserAndClass.mockReturnValue(undefined);
  });

  it("rejects non-staff", async () => {
    mockFindUserById.mockReturnValue(MEMBER_USER);
    const res = await callWorkout({ exercises: TEMPLATE }, signSession({ userId: MEMBER_USER.id }));
    expect(res.status).toBe(403);
    expect(mockSaveClassWorkout).not.toHaveBeenCalled();
  });

  it("requires at least one template exercise", async () => {
    const res = await callWorkout({ exercises: [] }, signSession({ userId: STAFF_USER.id }));
    expect(res.status).toBe(400);
  });

  it("saves the template and syncs results only for checked-in members", async () => {
    mockFindBookingsByClassId.mockReturnValue([
      { id: "b1", classId: "class-1", userId: "member-1", attendedAt: "2026-07-15T18:05:00.000Z" },
      { id: "b2", classId: "class-1", userId: "member-2", attendedAt: null }, // booked, not checked in
    ]);

    const res = await callWorkout(
      {
        notes: "Strength block week 3",
        exercises: TEMPLATE,
        results: [
          {
            userId: "member-1",
            notes: "Moved well",
            exercises: [{ name: "Back Squat", weight: "80", reps: 5, sets: 5, rpe: 8 }],
          },
          {
            userId: "member-2",
            exercises: [{ name: "Back Squat", weight: "70", reps: 5, sets: 5 }],
          },
        ],
      },
      signSession({ userId: STAFF_USER.id })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toContain("Synced to 1 member");
    expect(data.message).toContain("1 entry skipped");

    expect(mockSaveClassWorkout.mock.calls[0][0]).toMatchObject({
      classId: "class-1",
      notes: "Strength block week 3",
      updatedByStaffId: "staff-1",
    });

    // Exactly one member session, carrying provenance + performed values.
    expect(mockSaveWorkoutSession).toHaveBeenCalledTimes(1);
    const session = mockSaveWorkoutSession.mock.calls[0][0];
    expect(session).toMatchObject({
      userId: "member-1",
      classId: "class-1",
      recordedByStaffId: "staff-1",
      date: "2026-07-15",
      title: "Evening Strength",
      notes: "Moved well",
    });
    expect(session.exercises[0]).toMatchObject({ weight: "80", reps: 5, rpe: 8 });
  });

  it("re-syncing updates the same member session instead of duplicating", async () => {
    mockFindBookingsByClassId.mockReturnValue([
      { id: "b1", classId: "class-1", userId: "member-1", attendedAt: "2026-07-15T18:05:00.000Z" },
    ]);
    mockFindWorkoutSessionByUserAndClass.mockReturnValue({
      id: "session-existing",
      userId: "member-1",
      classId: "class-1",
      date: "2026-07-15",
      title: "Evening Strength",
      durationMins: 60,
      notes: "old",
      exercises: [],
      runs: [],
      createdAt: "2026-07-15T19:00:00.000Z",
      updatedAt: "2026-07-15T19:00:00.000Z",
    });

    const res = await callWorkout(
      {
        exercises: TEMPLATE,
        results: [{ userId: "member-1", exercises: [{ name: "Back Squat", weight: "85", reps: 3, sets: 5 }] }],
      },
      signSession({ userId: STAFF_USER.id })
    );

    expect(res.status).toBe(200);
    const session = mockSaveWorkoutSession.mock.calls[0][0];
    expect(session.id).toBe("session-existing");
    expect(session.createdAt).toBe("2026-07-15T19:00:00.000Z");
    expect(session.exercises[0].weight).toBe("85");
  });
});
