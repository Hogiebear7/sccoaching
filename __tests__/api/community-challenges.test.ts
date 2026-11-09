// Community group challenges (server): the organiser sets one (volume, days trained, or best squat / bench / deadlift between two dates), members see
// live standings scored from their own logged workouts. Real routes, real datastore file (helpers/iap-fixture.ts), real signed sessions and access
// rules. Fake ids only. What this proves: only the organiser creates or cancels; the dates and limits hold; scoring counts only workouts inside the dates
// and follows the leaderboard's privacy rules (opt-out, real-name setting, blocks); only group members can see anything; deleting an account removes its
// group's challenges.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
let fx: IapFixture;
let seq = 0;

const dayOffset = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const TODAY = dayOffset(0);
const IN_RANGE = dayOffset(2);

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string; challengeId: string }> }) => Promise<Response>;
async function call(path: string, userId: string | null, opts: { body?: unknown; id?: string; challengeId?: string; method?: string } = {}) {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  const mod = (await import(`@/app/api/mobile/community/${path}/route`)) as Record<string, Handler>;
  const req = new NextRequest(`http://localhost/api/mobile/community/${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(userId ? { Cookie: fx.cookie(userId) } : {}) },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  return mod[method](req, { params: Promise.resolve({ id: opts.id ?? "", challengeId: opts.challengeId ?? "" }) });
}

function member(opts: { app?: boolean; name?: string } = {}) {
  const { app = true, name = `Member ${seq + 1}` } = opts;
  const user = fx.db.createUserWithRole(`c${++seq}@example.test`, "x", "member", null);
  fx.db.saveProfile({ userId: user.id, fullName: name, email: user.email, createdAt: T, updatedAt: T } as never);
  if (app) {
    fx.db.saveDigitalEntitlement({
      id: `staff_grant:${user.id}`, userId: user.id, source: "staff_grant", status: "active", productId: null, billingOptionId: null, storeRefHash: null,
      environment: null, currentPeriodEnd: null, autoRenewing: false, grantedByUserId: null, note: "test", revokedAt: null, createdAt: T, updatedAt: T,
    } as never);
    fx.db.saveCommunityPrivacy({ userId: user.id, discoverable: true, leaderboardVisible: true, showRealName: true, adultConfirmedAt: T, createdAt: T, updatedAt: T });
  }
  return user;
}

/** An organiser plus the given members, all in one group. */
async function groupWith(names: string[] = []) {
  const org = member({ name: "Olive Organiser" });
  const g = (await (await call("groups", org.id, { body: { name: "Crew" } })).json()).data;
  const others = [];
  for (const name of names) {
    const m = member({ name });
    await call("groups/join", m.id, { body: { code: g.inviteCode } });
    others.push(m);
  }
  return { org, others, id: g.id as string };
}

const exercise = (name: string, weight: number, reps: number, sets: number) => ({ exerciseId: null, name, weight: String(weight), reps, sets });
let wk = 0;
function train(userId: string, date: string, exercises: unknown[] = [exercise("Back Squat", 100, 5, 3)]) {
  fx.db.saveWorkoutSession({ id: `w${++wk}`, userId, date, title: "Session", exercises, runs: [], createdAt: T, updatedAt: T } as never);
}

const mk = (org: { id: string }, id: string, over: Record<string, unknown> = {}) =>
  call("groups/[id]/challenges", org.id, { id, body: { title: "March volume", metric: "volume", startDate: TODAY, endDate: dayOffset(6), ...over } });
const standings = async (who: { id: string }, id: string, challengeId: string) => {
  const res = await call("groups/[id]/challenges/[challengeId]", who.id, { id, challengeId });
  return { res, body: await res.json() };
};

beforeEach(async () => {
  fx = await createFixture();
});
afterEach(() => fx.cleanup());

describe("setting a challenge", () => {
  it("the organiser creates one; a member, a stranger and a Free member can't", async () => {
    const { org, others, id } = await groupWith(["Alice"]);
    const res = await mk(org, id);
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ title: "March volume", metric: "volume", status: "active", startDate: TODAY });

    expect((await mk(others[0], id)).status).toBe(404);
    expect((await mk(member(), id)).status).toBe(404);
    const free = member({ app: false });
    const refused = await mk(free, id);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "upgrade_required" });
    expect((await call("groups/[id]/challenges", null, { id, body: {} })).status).toBe(401);
  });

  it("checks the title, the scoring choice and the dates", async () => {
    const { org, id } = await groupWith();
    const bad = async (over: Record<string, unknown>) => (await mk(org, id, over)).status;
    expect(await bad({ title: "  " })).toBe(400);
    expect(await bad({ title: "x".repeat(61) })).toBe(400);
    expect(await bad({ metric: "steps" })).toBe(400);
    expect(await bad({ startDate: "2026-02-31" })).toBe(400);
    expect(await bad({ startDate: dayOffset(-1) })).toBe(400); // can't start in the past
    expect(await bad({ startDate: dayOffset(61), endDate: dayOffset(70) })).toBe(400); // too far ahead
    expect(await bad({ endDate: dayOffset(-3) })).toBe(400); // ends before it starts
    expect(await bad({ endDate: dayOffset(90) })).toBe(400); // 91 days
    expect(await bad({ endDate: dayOffset(89) })).toBe(201); // exactly 90 days is fine
  });

  it("allows 5 open challenges at once; canceling one frees a place", async () => {
    const { org, id } = await groupWith();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push((await (await mk(org, id, { title: `C${i}` })).json()).data.id);
    const sixth = await mk(org, id, { title: "C6" });
    expect(sixth.status).toBe(409);
    expect((await call("groups/[id]/challenges/[challengeId]/cancel", org.id, { id, challengeId: ids[0], body: {} })).status).toBe(200);
    expect((await mk(org, id, { title: "C6" })).status).toBe(201);
  });

  it("lists upcoming, active and canceled challenges to members only", async () => {
    const { org, others, id } = await groupWith(["Alice"]);
    const a = (await (await mk(org, id, { title: "Now" })).json()).data;
    await mk(org, id, { title: "Soon", startDate: dayOffset(5), endDate: dayOffset(9) });
    await call("groups/[id]/challenges/[challengeId]/cancel", org.id, { id, challengeId: a.id, body: {} });
    const seen = (await (await call("groups/[id]/challenges", others[0].id, { id })).json()).data;
    expect(Object.fromEntries(seen.map((c: { title: string; status: string }) => [c.title, c.status]))).toEqual({ Now: "canceled", Soon: "upcoming" });
    expect((await call("groups/[id]/challenges", member().id, { id })).status).toBe(404);
  });
});

describe("standings", () => {
  it("volume: ranks members by logged volume inside the dates only, with ties by order and nothing for people with no workouts", async () => {
    const { org, others, id } = await groupWith(["Alice", "Bob", "Cara"]);
    const [alice, bob] = others;
    const c = (await (await mk(org, id)).json()).data;
    train(alice.id, IN_RANGE, [exercise("Row", 50, 10, 3)]); // 1500
    train(bob.id, IN_RANGE, [exercise("Row", 100, 10, 3)]); // 3000
    train(bob.id, dayOffset(-5), [exercise("Row", 500, 10, 3)]); // before the challenge: must not count
    train(alice.id, dayOffset(20), [exercise("Row", 500, 10, 3)]); // after the challenge: must not count
    const { res, body } = await standings(alice, id, c.id);
    expect(res.status).toBe(200);
    expect(body.data.entries.map((e: { displayName: string; value: number }) => [e.displayName, e.value])).toEqual([["Bob", 3000], ["Alice", 1500]]);
    expect(body.data.myUserId).toBe(alice.id);
  });

  it("days trained: counts each day once and ignores empty sessions", async () => {
    const { org, others, id } = await groupWith(["Alice", "Bob"]);
    const [alice, bob] = others;
    const c = (await (await mk(org, id, { metric: "workouts" })).json()).data;
    train(alice.id, dayOffset(1));
    train(alice.id, dayOffset(1)); // same day: once
    train(alice.id, dayOffset(3));
    train(bob.id, dayOffset(1), []); // empty session: nothing
    const { body } = await standings(bob, id, c.id);
    expect(body.data.entries.map((e: { displayName: string; value: number }) => [e.displayName, e.value])).toEqual([["Alice", 2]]);
  });

  it("best lift: the heaviest squat inside the dates", async () => {
    const { org, others, id } = await groupWith(["Alice", "Bob"]);
    const [alice, bob] = others;
    const c = (await (await mk(org, id, { metric: "squat" })).json()).data;
    train(alice.id, dayOffset(1), [exercise("Back Squat", 120, 3, 3)]);
    train(alice.id, dayOffset(-2), [exercise("Back Squat", 200, 1, 1)]); // before the dates
    train(bob.id, dayOffset(2), [exercise("Back Squat", 140, 1, 1)]);
    const { body } = await standings(alice, id, c.id);
    expect(body.data.entries.map((e: { displayName: string; value: number }) => [e.displayName, e.value])).toEqual([["Bob", 140], ["Alice", 120]]);
  });

  it("follows the leaderboard privacy rules: opt-out is left out (and told), real-name setting applies, a blocked member is hidden", async () => {
    const { org, others, id } = await groupWith(["Alice Adams", "Bob Brown", "Cara Clark"]);
    const [alice, bob, cara] = others;
    const c = (await (await mk(org, id)).json()).data;
    for (const m of others) train(m.id, IN_RANGE, [exercise("Row", 50, 10, 3)]);
    fx.db.saveCommunityPrivacy({ userId: bob.id, discoverable: true, leaderboardVisible: false, showRealName: true, adultConfirmedAt: T, createdAt: T, updatedAt: T });
    fx.db.saveCommunityPrivacy({ userId: cara.id, discoverable: true, leaderboardVisible: true, showRealName: false, adultConfirmedAt: T, createdAt: T, updatedAt: T });

    const asAlice = await standings(alice, id, c.id);
    expect(asAlice.body.data.entries.map((e: { displayName: string }) => e.displayName).sort()).toEqual(["Alice Adams", "Cara C."]);
    expect(asAlice.body.data.iAmHidden).toBe(false);
    expect((await standings(bob, id, c.id)).body.data.iAmHidden).toBe(true);

    fx.db.saveProfile({ ...(fx.db.findProfileByUserId(alice.id) as object), blockedUserIds: [cara.id] } as never);
    const after = await standings(alice, id, c.id);
    expect(after.body.data.entries.map((e: { userId: string }) => e.userId)).toEqual([alice.id]);
    expect(JSON.stringify(after.body)).not.toMatch(/@example\.test/);
  });

  it("only members of that group can see it: a stranger, another group's member, and a mismatched challenge all read as not found", async () => {
    const one = await groupWith(["Alice"]);
    const two = await groupWith(["Zed"]);
    const c1 = (await (await mk(one.org, one.id)).json()).data;
    const c2 = (await (await mk(two.org, two.id, { title: "Other" })).json()).data;

    const stranger = await standings(member(), one.id, c1.id);
    const otherGroup = await standings(two.others[0], one.id, c1.id);
    const wrongPair = await standings(one.others[0], one.id, c2.id); // a member of group one asking for group two's challenge
    for (const r of [stranger, otherGroup, wrongPair]) expect(r.res.status).toBe(404);
    expect(otherGroup.body).toEqual(stranger.body);
    expect(wrongPair.body).toEqual({ success: false, message: "Challenge not found." });
    expect((await standings(one.others[0], one.id, c1.id)).res.status).toBe(200);
  });
});

describe("canceling", () => {
  it("only the organiser can; it is reported as canceled; canceling twice is refused", async () => {
    const { org, others, id } = await groupWith(["Alice"]);
    const c = (await (await mk(org, id)).json()).data;
    expect((await call("groups/[id]/challenges/[challengeId]/cancel", others[0].id, { id, challengeId: c.id, body: {} })).status).toBe(404);
    expect((await standings(others[0], id, c.id)).body.data.challenge.status).toBe("active");
    expect((await call("groups/[id]/challenges/[challengeId]/cancel", org.id, { id, challengeId: c.id, body: {} })).status).toBe(200);
    expect((await standings(others[0], id, c.id)).body.data.challenge.status).toBe("canceled");
    expect((await call("groups/[id]/challenges/[challengeId]/cancel", org.id, { id, challengeId: c.id, body: {} })).status).toBe(409);
  });
});

describe("account deletion", () => {
  it("deleting the organiser removes the group's challenges; deleting a member leaves them", async () => {
    const { org, others, id } = await groupWith(["Alice"]);
    await mk(org, id);
    fx.db.deleteUserAndOwnedRecords(others[0].id);
    expect(fx.db.findChallengesByScope("group", id)).toHaveLength(1);
    fx.db.deleteUserAndOwnedRecords(org.id);
    expect(fx.db.findChallengesByScope("group", id)).toEqual([]);
  });
});

void vi;
