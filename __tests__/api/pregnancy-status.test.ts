// POST /api/pregnancy/status: birth date, breastfeeding, sharing at any
// stage, and the "goal paused" notice.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findProfileByUserId: vi.fn(),
  findPregnancyStatusByUserId: vi.fn(),
  savePregnancyStatus: vi.fn(),
  createNotification: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const PROFILE = {
  userId: "user-1",
  gender: "Female",
  primaryGoal: "Weight Loss",
  goalPacePctPerWeek: null,
  cycleTrackingEligible: true,
};

const TODAY = new Date().toISOString().slice(0, 10);
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

async function post(body: unknown) {
  const { POST } = await import("@/app/api/pregnancy/status/route");
  const cookie = signSession({ userId: "user-1" }, MEMBER_SESSION_LIFETIME_MS);
  return POST(
    new NextRequest("http://localhost/api/pregnancy/status", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `session=${cookie}` },
      body: JSON.stringify(body),
    })
  );
}

const saved = () => h.savePregnancyStatus.mock.calls.at(-1)![0];

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockReturnValue({ id: "user-1" });
  h.findProfileByUserId.mockReturnValue({ ...PROFILE });
  h.findPregnancyStatusByUserId.mockReturnValue(undefined);
});

describe("POST /api/pregnancy/status", () => {
  it("lets the member share with their coach from the start", async () => {
    const res = await post({ isPregnant: true, weeksAlong: 6, shareWithCoach: true });
    expect(res.status).toBe(200);
    expect(saved().shareWithCoach).toBe(true);
  });

  it("tells a member with a weight-loss goal that it's paused", async () => {
    const res = await post({ isPregnant: true, weeksAlong: 8 });
    expect((await res.json()).data.goalPaused).toBe(true);
    expect(h.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "nutrition_update", title: "Your weight goal is paused" })
    );
  });

  it("says nothing for a maintenance goal, or on later updates", async () => {
    h.findProfileByUserId.mockReturnValue({ ...PROFILE, primaryGoal: "General Health" });
    await post({ isPregnant: true, weeksAlong: 8 });
    h.findProfileByUserId.mockReturnValue({ ...PROFILE });
    h.findPregnancyStatusByUserId.mockReturnValue({ userId: "user-1", isPregnant: true, dueDate: "2027-05-20", shareWithCoach: false, createdAt: "x", updatedAt: "x" });
    await post({ isPregnant: true });
    expect(h.createNotification).not.toHaveBeenCalled();
  });

  it("records the birth and breastfeeding, and when breastfeeding stopped", async () => {
    const existing = { userId: "user-1", isPregnant: true, dueDate: daysAgo(5), shareWithCoach: false, createdAt: "x", updatedAt: "x" };
    h.findPregnancyStatusByUserId.mockReturnValue(existing);
    await post({ isPregnant: true, birthDate: daysAgo(10), breastfeeding: true });
    expect(saved()).toMatchObject({ birthDate: daysAgo(10), breastfeeding: true, breastfeedingEndedOn: null });

    h.findPregnancyStatusByUserId.mockReturnValue({ ...existing, birthDate: daysAgo(10), breastfeeding: true });
    await post({ isPregnant: true, breastfeeding: false });
    expect(saved()).toMatchObject({ breastfeeding: false, breastfeedingEndedOn: TODAY });
  });

  it("rejects a birth date in the future", async () => {
    h.findPregnancyStatusByUserId.mockReturnValue({ userId: "user-1", isPregnant: true, dueDate: "2027-05-20", shareWithCoach: false, createdAt: "x", updatedAt: "x" });
    const res = await post({ isPregnant: true, birthDate: "2099-01-01" });
    expect(res.status).toBe(400);
  });

  it("clears everything when pregnancy tracking is switched off", async () => {
    h.findPregnancyStatusByUserId.mockReturnValue({ userId: "user-1", isPregnant: true, dueDate: "2027-05-20", birthDate: "2027-05-14", breastfeeding: true, shareWithCoach: true, createdAt: "x", updatedAt: "x" });
    await post({ isPregnant: false });
    expect(saved()).toMatchObject({ isPregnant: false, dueDate: null, birthDate: null, breastfeeding: null, shareWithCoach: false });
  });
});
