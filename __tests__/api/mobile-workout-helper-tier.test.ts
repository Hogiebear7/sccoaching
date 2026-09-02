import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const { mockFindUserById, mockFindRecoveryLogsByUserId, mockFindWorkoutSessionsByUserId, mockFindWeeklyTrainingScheduleByUserId } =
  vi.hoisted(() => ({
    mockFindUserById: vi.fn(),
    mockFindRecoveryLogsByUserId: vi.fn(),
    mockFindWorkoutSessionsByUserId: vi.fn(),
    mockFindWeeklyTrainingScheduleByUserId: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findRecoveryLogsByUserId: mockFindRecoveryLogsByUserId,
  findWorkoutSessionsByUserId: mockFindWorkoutSessionsByUserId,
  findWeeklyTrainingScheduleByUserId: mockFindWeeklyTrainingScheduleByUserId,
}));

const MEMBER_USER = { id: "user-1", email: "athlete@example.com", role: "member" as const };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function callTierRoute(cookie?: string) {
  const { GET } = await import("@/app/api/mobile/workout-helper/tier/route");
  const request = new NextRequest("http://localhost/api/mobile/workout-helper/tier", {
    headers: cookie ? { Cookie: `session=${cookie}` } : {},
  });
  return GET(request);
}

describe("GET /api/mobile/workout-helper/tier", () => {
  beforeEach(() => {
    mockFindUserById.mockReset();
    mockFindRecoveryLogsByUserId.mockReset();
    mockFindWorkoutSessionsByUserId.mockReset();
    mockFindWeeklyTrainingScheduleByUserId.mockReset();
    mockFindUserById.mockReturnValue(MEMBER_USER);
    mockFindRecoveryLogsByUserId.mockReturnValue([]);
    mockFindWorkoutSessionsByUserId.mockReturnValue([]);
    mockFindWeeklyTrainingScheduleByUserId.mockReturnValue(undefined);
  });

  it("rejects requests with no session cookie", async () => {
    const res = await callTierRoute();
    expect(res.status).toBe(401);
  });

  it("returns a standard tier when there's no recovery log and nothing planned today", async () => {
    const cookie = signSession({ userId: MEMBER_USER.id });
    const res = await callTierRoute(cookie);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.tier).toBe("standard");
    expect(data.data.tierLabel).toBe("Standard session");
    expect(data.data.readinessScore).toBeNull();
  });

  it("downgrades to reduced when a heavy session is already planned/booked today", async () => {
    const today = todayISO();
    const todayWeekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    mockFindRecoveryLogsByUserId.mockReturnValue([
      {
        id: "rec-1",
        userId: MEMBER_USER.id,
        date: today,
        sleepHours: 7,
        sleepQuality: 6,
        soreness: 3,
        fatigue: 3,
        trainingDurationMins: null,
        rpe: null,
        goal: null,
        notes: null,
        readinessScore: 82, // would be "full" alone
        createdAt: `${today}T08:00:00.000Z`,
        updatedAt: `${today}T08:00:00.000Z`,
      },
    ]);
    mockFindWeeklyTrainingScheduleByUserId.mockReturnValue({
      userId: MEMBER_USER.id,
      updatedAt: today,
      sessions: [
        {
          id: "wt-1",
          dayOfWeek: todayWeekday,
          label: "Match day",
          activityType: "sport",
          timeOfDay: null,
          intensity: "heavy",
          estimatedDurationMins: null,
          notes: null,
          recurring: true,
          weekOf: null,
          sourceBookingId: null,
        },
      ],
    });
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callTierRoute(cookie);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.tier).toBe("standard"); // "full" downgraded one step
    expect(data.data.rationale).toContain("booked or planned");
  });
});
