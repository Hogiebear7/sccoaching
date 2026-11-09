// GET /api/staff/members/[userId]/summary and /brief: real routes, real datastore (helpers/iap-fixture.ts), real signed sessions. Fake ids only.
// What this proves: coach and above in the member's own gym get the data for a member with a gym Membership; anyone else's member (no Membership) is
// walled; another gym, a staff target and a plain member caller are refused; the check-in note reaches the coach.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
const today = () => new Date().toISOString().slice(0, 10);
let fx: IapFixture;
let seq = 0;

type Handler = (req: NextRequest, ctx: { params: Promise<{ userId: string }> }) => Promise<Response>;
async function get(kind: "summary" | "brief", callerId: string | null, userId: string) {
  const mod = (await import(`@/app/api/staff/members/[userId]/${kind}/route`)) as { GET: Handler };
  return mod.GET(
    new NextRequest(`http://localhost/api/staff/members/${userId}/${kind}`, { headers: callerId ? { Cookie: fx.cookie(callerId) } : {} }),
    { params: Promise.resolve({ userId }) }
  );
}

function member(opts: { membership?: boolean; gymId?: string | null; name?: string } = {}) {
  const { membership = true, gymId = null, name = `Member ${seq + 1}` } = opts;
  const user = fx.db.createUserWithRole(`q${++seq}@example.test`, "x", "member", gymId);
  fx.db.saveProfile({ userId: user.id, fullName: name, email: user.email, primaryGoal: "General Health", createdAt: T, updatedAt: T } as never);
  if (membership) fx.setSubscription(user.id, { packageId: gymId ? fx.ids.gymBMembershipPackage : fx.ids.membershipPackage, status: "active" });
  return user;
}

beforeEach(async () => {
  fx = await createFixture();
});
afterEach(() => fx.cleanup());

describe("the full summary", () => {
  it("a coach gets the picture for a Membership member, including a current health note from their check-in", async () => {
    const coach = fx.db.createUserWithRole("coach@example.test", "x", "coach", null);
    const m = member({ name: "Mary Murphy" });
    fx.db.saveWorkoutSession({ id: "w1", userId: m.id, date: today(), title: "Lower", durationMins: 40, notes: null, sessionRpe: 8, exercises: [{ exerciseId: null, name: "Squat", weight: "100", reps: 5, sets: 3 }], runs: [], createdAt: T, updatedAt: T } as never);
    fx.db.saveRecoveryLog({ id: "r1", userId: m.id, date: today(), sleepHours: 6, sleepQuality: 6, soreness: 5, fatigue: 3, scale10: true, trainingDurationMins: null, rpe: null, goal: null, notes: null, healthNote: "Pulled my hamstring", readinessScore: 60, createdAt: T, updatedAt: T } as never);

    const res = await get("summary", coach.id, m.id);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ walled: false, name: "Mary Murphy", state: "caution" });
    expect(data.training).toMatchObject({ daysTrainedLast7: 1, effortLast3Days: "hard" });
    expect(data.checkIns.healthNote).toMatchObject({ note: "Pulled my hamstring", mentionsIllnessOrInjury: true });
    expect(data.flags.map((f: { code: string }) => f.code)).toContain("health_note");
  });

  it("a member without a gym Membership is walled: no data, whatever else they hold", async () => {
    const coach = fx.db.createUserWithRole("coach@example.test", "x", "coach", null);
    const free = member({ membership: false });
    fx.db.saveWorkoutSession({ id: "w1", userId: free.id, date: today(), title: "Secret", durationMins: 40, notes: null, exercises: [], runs: [], createdAt: T, updatedAt: T } as never);
    const body = await (await get("summary", coach.id, free.id)).json();
    expect(body.data).toEqual({ walled: true, message: "A summary is available for members with a gym Membership." });
    expect(JSON.stringify(body)).not.toContain("Secret");
  });

  it("another gym's member, a missing member and a staff account all read as not found; a plain member and a signed-out caller are refused", async () => {
    const coach = fx.db.createUserWithRole("coach@example.test", "x", "coach", null);
    const other = fx.db.createUserWithRole("coach-b@example.test", "x", "coach", GYM_B);
    const m = member();
    for (const target of [member({ gymId: GYM_B }).id, "member-missing", other.id]) {
      const res = await get("summary", coach.id, target);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ success: false, message: "Member not found." });
    }
    expect((await get("summary", member().id, m.id)).status).toBe(403);
    expect((await get("summary", null, m.id)).status).toBe(401);
  });
});

describe("the class brief", () => {
  it("is compact: a state, flags and a few lines, with the health note, for a Membership member; walled for anyone else", async () => {
    const coach = fx.db.createUserWithRole("coach@example.test", "x", "coach", null);
    const m = member();
    fx.db.saveRecoveryLog({ id: "r1", userId: m.id, date: today(), sleepHours: 8, sleepQuality: 8, soreness: 2, fatigue: 1, scale10: true, trainingDurationMins: null, rpe: null, goal: null, notes: null, healthNote: "Streaming cold", readinessScore: 85, createdAt: T, updatedAt: T } as never);
    const { data } = await (await get("brief", coach.id, m.id)).json();
    expect(data).toMatchObject({ walled: false, state: "caution", healthNote: { note: "Streaming cold" } });
    expect(data.lines.length).toBeGreaterThanOrEqual(4);
    expect(data.lines.length).toBeLessThanOrEqual(6);
    expect(JSON.stringify(data)).not.toMatch(/@example\.test/);

    const walled = await (await get("brief", coach.id, member({ membership: false }).id)).json();
    expect(walled.data).toEqual({ walled: true, message: "A brief is available for members with a gym Membership." });
  });
});
