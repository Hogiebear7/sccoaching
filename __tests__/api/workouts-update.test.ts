import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const { mockFindUserById, mockFindWorkoutSessionById, mockSaveWorkoutSession } = vi.hoisted(
  () => ({
    mockFindUserById: vi.fn(),
    mockFindWorkoutSessionById: vi.fn(),
    mockSaveWorkoutSession: vi.fn(),
  })
);

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findWorkoutSessionById: mockFindWorkoutSessionById,
  saveWorkoutSession: mockSaveWorkoutSession,
}));

const MEMBER = { id: "member-1", email: "alex@example.com", role: "member" as const };

function todayLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function classSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    userId: "member-1",
    date: todayLocalISO(),
    title: "Evening Strength",
    durationMins: 60,
    notes: null,
    exercises: [{ exerciseId: null, name: "Back Squat", weight: "80", reps: 5, sets: 5, notes: null }],
    runs: [],
    classId: "class-1",
    recordedByStaffId: "staff-1",
    createdAt: "x",
    updatedAt: "x",
    ...overrides,
  };
}

async function callUpdate(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/workouts/update/route");
  const request = new NextRequest("http://localhost/api/workouts/update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

const VALID_BODY = {
  sessionId: "session-1",
  notes: "Felt heavy",
  exercises: [{ name: "Back Squat", weight: "82.5", reps: 5, sets: 5, rpe: 9 }],
};

describe("POST /api/workouts/update (same-day class correction)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockReturnValue(MEMBER);
    mockFindWorkoutSessionById.mockReturnValue(classSession());
  });

  it("lets the member correct a class workout on the day of the class", async () => {
    const res = await callUpdate(VALID_BODY, signSession({ userId: MEMBER.id }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toBe("Workout updated.");
    const saved = mockSaveWorkoutSession.mock.calls[0][0];
    expect(saved.exercises[0]).toMatchObject({ weight: "82.5", rpe: 9 });
    expect(saved.notes).toBe("Felt heavy");
    // Provenance and identity survive the correction.
    expect(saved.classId).toBe("class-1");
    expect(saved.id).toBe("session-1");
  });

  it("refuses once the calendar day has passed", async () => {
    mockFindWorkoutSessionById.mockReturnValue(classSession({ date: "2026-07-01" }));

    const res = await callUpdate(VALID_BODY, signSession({ userId: MEMBER.id }));
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.message).toContain("edit window has closed");
    expect(mockSaveWorkoutSession).not.toHaveBeenCalled();
  });

  it("refuses non-class sessions and other members' sessions", async () => {
    mockFindWorkoutSessionById.mockReturnValue(classSession({ classId: null }));
    const selfLogged = await callUpdate(VALID_BODY, signSession({ userId: MEMBER.id }));
    expect(selfLogged.status).toBe(403);

    mockFindWorkoutSessionById.mockReturnValue(classSession({ userId: "member-2" }));
    const notMine = await callUpdate(VALID_BODY, signSession({ userId: MEMBER.id }));
    expect(notMine.status).toBe(404);

    expect(mockSaveWorkoutSession).not.toHaveBeenCalled();
  });

  it("requires at least one exercise", async () => {
    const res = await callUpdate(
      { sessionId: "session-1", exercises: [] },
      signSession({ userId: MEMBER.id })
    );
    expect(res.status).toBe(400);
  });
});
