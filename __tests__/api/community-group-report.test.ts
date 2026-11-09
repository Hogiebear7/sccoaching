// Reporting a Community group (its name or description). Real routes, real datastore (helpers/iap-fixture.ts), real signed sessions. Fake ids only.
// What this proves: a member of the group can report it with a reason; a stranger, a Free member, someone without the 18+ confirmation and a signed-out
// caller cannot; an organiser cannot report their own group; a double tap queues one report; the report reaches the staff of the organiser's gym with the
// group's name and description, and only that gym's staff; and resolving it closes the group (dismissing it does not).
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
let fx: IapFixture;
let seq = 0;

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
async function call(path: string, userId: string | null, body?: unknown, id = "", method = "POST") {
  const mod = (await import(`@/app/api/mobile/community/${path}/route`)) as Record<string, Handler>;
  return mod[method](
    new NextRequest(`http://localhost/api/mobile/community/${path.replace("[id]", id)}`, {
      method,
      headers: { "Content-Type": "application/json", ...(userId ? { Cookie: fx.cookie(userId) } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id }) }
  );
}

async function staff(path: string, userId: string, body?: unknown, id = "", method = "GET") {
  const mod = (await import(`@/app/api/staff/community/${path}/route`)) as Record<string, Handler>;
  return mod[method](
    new NextRequest(`http://localhost/api/staff/community/${path.replace("[id]", id)}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: fx.cookie(userId) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id }) }
  );
}

function member(opts: { app?: boolean; adult?: boolean; gymId?: string | null; name?: string } = {}) {
  const { app = true, adult = true, gymId = null, name = `Member ${seq + 1}` } = opts;
  const user = fx.db.createUserWithRole(`gr${++seq}@example.test`, "x", "member", gymId);
  fx.db.saveProfile({ userId: user.id, fullName: name, email: user.email, createdAt: T, updatedAt: T } as never);
  if (app) {
    fx.db.saveDigitalEntitlement({
      id: `staff_grant:${user.id}`, userId: user.id, source: "staff_grant", status: "active", productId: null, billingOptionId: null, storeRefHash: null,
      environment: null, currentPeriodEnd: null, autoRenewing: false, grantedByUserId: null, note: "test", revokedAt: null, createdAt: T, updatedAt: T,
    } as never);
  }
  if (adult) {
    fx.db.saveCommunityPrivacy({ userId: user.id, discoverable: true, leaderboardVisible: true, showRealName: true, adultConfirmedAt: T, createdAt: T, updatedAt: T });
  }
  return user;
}

/** An organiser with a group, and a second member who has joined it by code. */
async function groupWithMember() {
  const organiser = member({ name: "Olive Organiser" });
  const joiner = member({ name: "Jo Joiner" });
  const created = await (await call("groups", organiser.id, { name: "Late Night Lifters", description: "Rude words here" })).json();
  const groupId = created.data.id as string;
  const joined = await call("groups/join", joiner.id, { code: created.data.inviteCode });
  expect(joined.status).toBe(200);
  return { organiser, joiner, groupId };
}

beforeEach(async () => {
  fx = await createFixture();
});
afterEach(() => fx.cleanup());

describe("who can report a group", () => {
  it("a member of the group can, with a reason", async () => {
    const { joiner, groupId } = await groupWithMember();
    const res = await call("groups/[id]/report", joiner.id, { reason: "Offensive description" }, groupId);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ success: true });
  });

  it("not a stranger, not signed out, not someone without the App tier or the 18+ confirmation", async () => {
    const { groupId } = await groupWithMember();
    const stranger = member();
    const free = member({ app: false });
    const noAdult = member({ adult: false });
    const path = "groups/[id]/report";
    expect((await call(path, stranger.id, { reason: "x" }, groupId)).status).toBe(404);
    expect((await call(path, null, { reason: "x" }, groupId)).status).toBe(401);
    expect((await call(path, free.id, { reason: "x" }, groupId)).status).toBe(403);
    const adultRes = await call(path, noAdult.id, { reason: "x" }, groupId);
    expect(adultRes.status).toBe(403);
    expect(await adultRes.json()).toMatchObject({ code: "adult_confirmation_required" });
  });

  it("the organiser cannot report their own group, and a reason is required and capped at 200 characters", async () => {
    const { organiser, joiner, groupId } = await groupWithMember();
    const path = "groups/[id]/report";
    expect((await call(path, organiser.id, { reason: "me" }, groupId)).status).toBe(400);
    expect((await call(path, joiner.id, { reason: "   " }, groupId)).status).toBe(400);
    expect((await call(path, joiner.id, {}, groupId)).status).toBe(400);
    expect((await call(path, joiner.id, { reason: "x".repeat(201) }, groupId)).status).toBe(400);
    expect((await call(path, joiner.id, { reason: "x".repeat(200) }, groupId)).status).toBe(201);
  });
});

describe("what staff see and do", () => {
  it("the report reaches the organiser's gym's coach with the group's name and description, once however many times it is sent", async () => {
    const { joiner, groupId } = await groupWithMember();
    const coach = fx.db.createUserWithRole("gr-coach@example.test", "x", "coach", null);
    for (let i = 0; i < 3; i++) await call("groups/[id]/report", joiner.id, { reason: "Offensive description" }, groupId);

    const list = await (await staff("gym-reports", coach.id)).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({
      targetType: "group",
      targetId: groupId,
      reason: "Offensive description",
      status: "open",
      alreadyRemoved: false,
      reporterName: "Jo Joiner",
      text: "Late Night Lifters\nRude words here",
    });
    expect(list.data[0].author).toMatchObject({ displayName: "Olive Organiser" });
  });

  it("another gym's coach sees nothing and cannot resolve it", async () => {
    const { joiner, groupId } = await groupWithMember();
    await call("groups/[id]/report", joiner.id, { reason: "Offensive" }, groupId);
    const otherCoach = fx.db.createUserWithRole("gr-coach-b@example.test", "x", "coach", GYM_B);
    expect((await (await staff("gym-reports", otherCoach.id)).json()).data).toEqual([]);
    const coach = fx.db.createUserWithRole("gr-coach@example.test", "x", "coach", null);
    const reportId = (await (await staff("gym-reports", coach.id)).json()).data[0].id as string;
    expect((await staff("gym-reports/[id]/resolve", otherCoach.id, { action: "resolve" }, reportId, "POST")).status).toBe(404);
  });

  it("resolving closes the group for everyone; dismissing leaves it open", async () => {
    const { organiser, joiner, groupId } = await groupWithMember();
    const coach = fx.db.createUserWithRole("gr-coach@example.test", "x", "coach", null);
    await call("groups/[id]/report", joiner.id, { reason: "Offensive" }, groupId);
    const reportId = (await (await staff("gym-reports", coach.id)).json()).data[0].id as string;

    // Dismiss first on a copy of the situation: the group stays.
    expect((await staff("gym-reports/[id]/resolve", coach.id, { action: "dismiss" }, reportId, "POST")).status).toBe(200);
    expect((await (await call("groups", joiner.id, undefined, "", "GET")).json()).data).toHaveLength(1);

    // A fresh report, resolved: the group is closed.
    await call("groups/[id]/report", joiner.id, { reason: "Still offensive" }, groupId);
    const second = (await (await staff("gym-reports", coach.id)).json()).data[0].id as string;
    const done = await staff("gym-reports/[id]/resolve", coach.id, { action: "resolve" }, second, "POST");
    expect(await done.json()).toMatchObject({ success: true, message: "Removed." });
    expect((await (await call("groups", joiner.id, undefined, "", "GET")).json()).data).toEqual([]);
    expect((await (await call("groups", organiser.id, undefined, "", "GET")).json()).data).toEqual([]);
  });
});
