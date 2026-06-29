import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const { mockFindUserById, mockSaveWorkoutSession } = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockSaveWorkoutSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  saveWorkoutSession: mockSaveWorkoutSession,
}));

async function callWorkoutsCreate(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/workouts/create/route");
  const request = new NextRequest("http://localhost/api/workouts/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/workouts/create", () => {
  beforeEach(() => {
    mockFindUserById.mockReset();
    mockSaveWorkoutSession.mockReset();
    mockFindUserById.mockReturnValue({ id: "user-1", email: "athlete@example.com" });
  });

  it("rejects requests with no session cookie", async () => {
    const res = await callWorkoutsCreate({ title: "Lower Body", date: "2026-06-19" });

    expect(res.status).toBe(401);
    expect(mockSaveWorkoutSession).not.toHaveBeenCalled();
  });

  it("rejects a missing title with 400", async () => {
    const cookie = signSession({ userId: "user-1" });

    const res = await callWorkoutsCreate({ title: "", date: "2026-06-19" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.message).toBe("Title is required.");
    expect(mockSaveWorkoutSession).not.toHaveBeenCalled();
  });

  it("rejects a missing date with 400", async () => {
    const cookie = signSession({ userId: "user-1" });

    const res = await callWorkoutsCreate({ title: "Lower Body", date: "" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.message).toBe("Date is required.");
    expect(mockSaveWorkoutSession).not.toHaveBeenCalled();
  });

  it("rejects a non-integer durationMins with 400", async () => {
    const cookie = signSession({ userId: "user-1" });

    const res = await callWorkoutsCreate(
      { title: "Lower Body", date: "2026-06-19", durationMins: "not-a-number" },
      cookie
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.message).toBe("Duration must be a whole number.");
    expect(mockSaveWorkoutSession).not.toHaveBeenCalled();
  });

  it("accepts valid input and creates a workout session owned by the caller", async () => {
    const cookie = signSession({ userId: "user-1" });

    const res = await callWorkoutsCreate(
      {
        title: "Lower Body Strength",
        date: "2026-06-19",
        durationMins: "65",
        notes: "Felt strong on squats",
      },
      cookie
    );
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.success).toBe(true);
    expect(mockSaveWorkoutSession).toHaveBeenCalledTimes(1);

    const saved = mockSaveWorkoutSession.mock.calls[0][0];
    expect(saved.userId).toBe("user-1");
    expect(saved.title).toBe("Lower Body Strength");
    expect(saved.date).toBe("2026-06-19");
    expect(saved.durationMins).toBe(65);
    expect(saved.notes).toBe("Felt strong on squats");
    expect(saved.id).toBeTruthy();
    expect(saved.createdAt).toBe(saved.updatedAt);
  });

  it("creates a second, independent record on a second valid call rather than overwriting the first", async () => {
    const cookie = signSession({ userId: "user-1" });

    await callWorkoutsCreate({ title: "Lower Body", date: "2026-06-18" }, cookie);
    await callWorkoutsCreate({ title: "Upper Body", date: "2026-06-19" }, cookie);

    expect(mockSaveWorkoutSession).toHaveBeenCalledTimes(2);

    const firstSaved = mockSaveWorkoutSession.mock.calls[0][0];
    const secondSaved = mockSaveWorkoutSession.mock.calls[1][0];

    expect(firstSaved.id).not.toBe(secondSaved.id);
    expect(firstSaved.title).toBe("Lower Body");
    expect(secondSaved.title).toBe("Upper Body");
    expect(firstSaved.userId).toBe("user-1");
    expect(secondSaved.userId).toBe("user-1");
  });
});
