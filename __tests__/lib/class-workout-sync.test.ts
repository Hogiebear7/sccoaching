import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindBookingsByClassId,
  mockFindClassById,
  mockFindClassWorkoutByClassId,
  mockFindWorkoutSessionByUserAndClass,
  mockSaveWorkoutSession,
} = vi.hoisted(() => ({
  mockFindBookingsByClassId: vi.fn(),
  mockFindClassById: vi.fn(),
  mockFindClassWorkoutByClassId: vi.fn(),
  mockFindWorkoutSessionByUserAndClass: vi.fn(),
  mockSaveWorkoutSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findBookingsByClassId: mockFindBookingsByClassId,
  findClassById: mockFindClassById,
  findClassWorkoutByClassId: mockFindClassWorkoutByClassId,
  findWorkoutSessionByUserAndClass: mockFindWorkoutSessionByUserAndClass,
  saveWorkoutSession: mockSaveWorkoutSession,
}));

import { syncClassWorkoutToAllBooked, syncClassWorkoutToMember } from "@/lib/class-workout-sync";

const CLASS_RECORD = {
  id: "class-1",
  title: "Semi-Private PT",
  date: "2026-08-10",
  startTime: "07:00",
  durationMins: 45,
};

const TEMPLATE = {
  classId: "class-1",
  notes: "Focus on hinge pattern",
  exercises: [{ name: "Deadlift", weight: "60", reps: 5, sets: 3 }],
  updatedByStaffId: "staff-1",
  createdAt: "x",
  updatedAt: "x",
};

describe("syncClassWorkoutToMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindClassById.mockReturnValue(CLASS_RECORD);
  });

  it("no-ops when the class has no workout template", () => {
    mockFindClassWorkoutByClassId.mockReturnValue(undefined);
    syncClassWorkoutToMember("class-1", "member-1");
    expect(mockSaveWorkoutSession).not.toHaveBeenCalled();
  });

  it("creates a new session seeded from the template for a member with no prior session", () => {
    mockFindClassWorkoutByClassId.mockReturnValue(TEMPLATE);
    mockFindWorkoutSessionByUserAndClass.mockReturnValue(undefined);

    syncClassWorkoutToMember("class-1", "member-1");

    expect(mockSaveWorkoutSession).toHaveBeenCalledTimes(1);
    const session = mockSaveWorkoutSession.mock.calls[0][0];
    expect(session).toMatchObject({
      userId: "member-1",
      classId: "class-1",
      title: "Semi-Private PT",
      date: "2026-08-10",
      notes: "Focus on hinge pattern",
      recordedByStaffId: "staff-1",
    });
    expect(session.exercises).toEqual(TEMPLATE.exercises);
  });

  it("adds only the template exercises the member doesn't already have, without touching existing values", () => {
    mockFindClassWorkoutByClassId.mockReturnValue({
      ...TEMPLATE,
      exercises: [
        { name: "Deadlift", weight: "60", reps: 5, sets: 3 },
        { name: "Plank", weight: null, reps: null, sets: 3 },
      ],
    });
    mockFindWorkoutSessionByUserAndClass.mockReturnValue({
      id: "session-existing",
      userId: "member-1",
      classId: "class-1",
      date: "2026-08-10",
      title: "Semi-Private PT",
      durationMins: 45,
      notes: "my own note",
      exercises: [{ name: "Deadlift", weight: "85", reps: 5, sets: 3 }], // member already logged their own weight
      runs: [],
      recordedByStaffId: "staff-1",
      createdAt: "2026-08-10T07:00:00.000Z",
      updatedAt: "2026-08-10T07:00:00.000Z",
    });

    syncClassWorkoutToMember("class-1", "member-1");

    const session = mockSaveWorkoutSession.mock.calls[0][0];
    expect(session.id).toBe("session-existing");
    // Member's own note and Deadlift weight are preserved, not overwritten.
    expect(session.notes).toBe("my own note");
    expect(session.exercises).toEqual([
      { name: "Deadlift", weight: "85", reps: 5, sets: 3 },
      { name: "Plank", weight: null, reps: null, sets: 3 },
    ]);
  });
});

describe("syncClassWorkoutToAllBooked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindClassById.mockReturnValue(CLASS_RECORD);
    mockFindWorkoutSessionByUserAndClass.mockReturnValue(undefined);
  });

  it("returns 0 and does nothing when there's no template", () => {
    mockFindClassWorkoutByClassId.mockReturnValue(undefined);
    mockFindBookingsByClassId.mockReturnValue([{ userId: "member-1" }]);

    const count = syncClassWorkoutToAllBooked("class-1");

    expect(count).toBe(0);
    expect(mockSaveWorkoutSession).not.toHaveBeenCalled();
  });

  it("syncs every booked member, regardless of check-in", () => {
    mockFindClassWorkoutByClassId.mockReturnValue(TEMPLATE);
    mockFindBookingsByClassId.mockReturnValue([
      { userId: "member-1", attendedAt: "2026-08-10T07:05:00.000Z" },
      { userId: "member-2", attendedAt: null },
    ]);

    const count = syncClassWorkoutToAllBooked("class-1");

    expect(count).toBe(2);
    expect(mockSaveWorkoutSession).toHaveBeenCalledTimes(2);
  });
});
