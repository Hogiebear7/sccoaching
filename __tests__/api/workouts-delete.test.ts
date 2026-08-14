import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const { mockFindUserById, mockFindWorkoutSessionById, mockDeleteWorkoutSession } = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindWorkoutSessionById: vi.fn(),
  mockDeleteWorkoutSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findWorkoutSessionById: mockFindWorkoutSessionById,
  deleteWorkoutSession: mockDeleteWorkoutSession,
}));

const MEMBER = { id: "member-1", email: "alex@example.com", role: "member" as const };

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    userId: "member-1",
    date: "2026-07-01",
    title: "Evening Strength",
    durationMins: 60,
    notes: null,
    exercises: [{ exerciseId: null, name: "Back Squat", weight: "80", reps: 5, sets: 5, notes: null }],
    runs: [],
    classId: null,
    recordedByStaffId: null,
    createdAt: "x",
    updatedAt: "x",
    ...overrides,
  };
}

async function callDelete(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/workouts/delete/route");
  const request = new NextRequest("http://localhost/api/workouts/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: `session=${cookie}` } : {}) },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/workouts/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockReturnValue(MEMBER);
  });

  it("rejects requests with no session cookie", async () => {
    const res = await callDelete({ id: "session-1" });
    expect(res.status).toBe(401);
    expect(mockDeleteWorkoutSession).not.toHaveBeenCalled();
  });

  it("rejects a missing id with 400", async () => {
    const res = await callDelete({}, signSession({ userId: MEMBER.id }));
    expect(res.status).toBe(400);
  });

  it("returns 404 for a session that doesn't exist", async () => {
    mockFindWorkoutSessionById.mockReturnValue(undefined);
    const res = await callDelete({ id: "missing" }, signSession({ userId: MEMBER.id }));
    expect(res.status).toBe(404);
    expect(mockDeleteWorkoutSession).not.toHaveBeenCalled();
  });

  it("returns 404 for another member's session rather than revealing it exists", async () => {
    mockFindWorkoutSessionById.mockReturnValue(session({ userId: "someone-else" }));
    const res = await callDelete({ id: "session-1" }, signSession({ userId: MEMBER.id }));
    expect(res.status).toBe(404);
    expect(mockDeleteWorkoutSession).not.toHaveBeenCalled();
  });

  it("deletes a self-logged session the member owns", async () => {
    mockFindWorkoutSessionById.mockReturnValue(session());
    const res = await callDelete({ id: "session-1" }, signSession({ userId: MEMBER.id }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockDeleteWorkoutSession).toHaveBeenCalledWith("session-1");
  });

  it("deletes a class-synced session the member owns — no classId restriction on delete", async () => {
    mockFindWorkoutSessionById.mockReturnValue(session({ classId: "class-1", recordedByStaffId: "staff-1" }));
    const res = await callDelete({ id: "session-1" }, signSession({ userId: MEMBER.id }));

    expect(res.status).toBe(200);
    expect(mockDeleteWorkoutSession).toHaveBeenCalledWith("session-1");
  });
});
