import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const { mockFindUserById, mockFindExerciseById, mockFindExercises, mockSaveExercise } = vi.hoisted(
  () => ({
    mockFindUserById: vi.fn(),
    mockFindExerciseById: vi.fn(),
    mockFindExercises: vi.fn(),
    mockSaveExercise: vi.fn(),
  })
);

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findExerciseById: mockFindExerciseById,
  findExercises: mockFindExercises,
  saveExercise: mockSaveExercise,
}));

const STAFF_USER = { id: "staff-1", email: "coach@example.com", role: "staff" as const };
const MEMBER_USER = { id: "member-1", email: "member@example.com", role: "member" as const };

async function callExercises(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/staff/exercises/route");
  const request = new NextRequest("http://localhost/api/staff/exercises", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/staff/exercises", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindExerciseById.mockReturnValue(undefined);
    mockFindExercises.mockReturnValue([]);
  });

  it("rejects non-staff", async () => {
    mockFindUserById.mockReturnValue(MEMBER_USER);
    const res = await callExercises(
      { name: "Deadlift", section: "lower_pull" },
      signSession({ userId: MEMBER_USER.id })
    );
    expect(res.status).toBe(403);
  });

  it("accepts the new core and cardio sections", async () => {
    for (const section of ["core", "cardio"]) {
      const res = await callExercises(
        { name: `Test ${section}`, section },
        signSession({ userId: STAFF_USER.id })
      );
      expect(res.status).toBe(200);
    }
    expect(mockSaveExercise).toHaveBeenCalledTimes(2);
  });

  it("stores trimmed description and cues, null when blank", async () => {
    const res = await callExercises(
      {
        name: "Deadlift",
        section: "lower_pull",
        description: "  Hip hinge loading the posterior chain.  ",
        cues: "Brace before you pull\nPush the floor away",
      },
      signSession({ userId: STAFF_USER.id })
    );

    expect(res.status).toBe(200);
    expect(mockSaveExercise.mock.calls[0][0]).toMatchObject({
      description: "Hip hinge loading the posterior chain.",
      cues: "Brace before you pull\nPush the floor away",
    });

    mockSaveExercise.mockClear();
    await callExercises(
      { name: "Row", section: "upper_pull", description: "   ", cues: "" },
      signSession({ userId: STAFF_USER.id })
    );
    expect(mockSaveExercise.mock.calls[0][0]).toMatchObject({ description: null, cues: null });
  });

  it("rejects over-length content", async () => {
    const long = "x".repeat(1001);
    const res = await callExercises(
      { name: "Deadlift", section: "lower_pull", description: long },
      signSession({ userId: STAFF_USER.id })
    );
    expect(res.status).toBe(400);

    const longCues = "x".repeat(601);
    const res2 = await callExercises(
      { name: "Deadlift", section: "lower_pull", cues: longCues },
      signSession({ userId: STAFF_USER.id })
    );
    expect(res2.status).toBe(400);
    expect(mockSaveExercise).not.toHaveBeenCalled();
  });

  it("still blocks duplicate names in the same section and preserves ids on edit", async () => {
    mockFindExercises.mockReturnValue([
      { id: "ex-1", name: "Deadlift", section: "lower_pull" },
    ]);
    const dup = await callExercises(
      { name: "deadlift", section: "lower_pull" },
      signSession({ userId: STAFF_USER.id })
    );
    expect(dup.status).toBe(400);

    mockFindExerciseById.mockReturnValue({
      id: "ex-1",
      name: "Deadlift",
      section: "lower_pull",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const edit = await callExercises(
      { id: "ex-1", name: "Deadlift", section: "lower_pull", description: "Updated." },
      signSession({ userId: STAFF_USER.id })
    );
    expect(edit.status).toBe(200);
    const saved = mockSaveExercise.mock.calls[0][0];
    expect(saved.id).toBe("ex-1");
    expect(saved.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(saved.description).toBe("Updated.");
  });
});
