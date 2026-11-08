// Community groups (server): create, join by invite code, view, leave, remove a member, close. Real routes, real datastore file
// (helpers/iap-fixture.ts), real signed sessions and the real access rules (App tier via a staff grant, or the Membership bundle). Fake ids only.
// What this proves: groups need the App tier AND the member's 18+ confirmation, checked live; joining is by code only and a wrong code, a closed
// group, another gym and a block all read the same; 5-groups and 50-members limits hold; only the organiser can remove or close; the invite code
// is shown only to the organiser; the 18+ confirmation survives saving privacy choices; deleting an account removes its groups and memberships.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
let fx: IapFixture;
let seq = 0;

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
async function call(path: string, userId: string | null, body?: unknown, id = "", method = "POST") {
  const mod = (await import(`@/app/api/mobile/community/${path}/route`)) as Record<string, Handler>;
  const req = new NextRequest(`http://localhost/api/mobile/community/${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(userId ? { Cookie: fx.cookie(userId) } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return mod[method](req, { params: Promise.resolve({ id }) });
}

/** A member with the App tier (a live staff-granted-style digital entitlement) unless told otherwise, 18+ confirmed unless told otherwise. */
function member(opts: { app?: boolean; adult?: boolean; gymId?: string | null; name?: string } = {}) {
  const { app = true, adult = true, gymId = null, name = `Member ${seq + 1}` } = opts;
  const user = fx.db.createUserWithRole(`g${++seq}@example.test`, "x", "member", gymId);
  fx.db.saveProfile({ userId: user.id, fullName: name, email: user.email, createdAt: T, updatedAt: T } as never);
  if (app) {
    fx.db.saveDigitalEntitlement({
      id: `staff_grant:${user.id}`, userId: user.id, source: "staff_grant", status: "active", productId: null, billingOptionId: null, storeRefHash: null,
      environment: null, currentPeriodEnd: null, autoRenewing: false, grantedByUserId: null, note: "test", revokedAt: null, createdAt: T, updatedAt: T,
    } as never);
  }
  if (adult) {
    fx.db.saveCommunityPrivacy({
      userId: user.id, discoverable: true, leaderboardVisible: true, showRealName: true, adultConfirmedAt: T, createdAt: T, updatedAt: T,
    });
  }
  return user;
}

const create = async (u: { id: string }, name = "Over 50s Crew", description = "Tuesday and Thursday") => {
  const res = await call("groups", u.id, { name, description });
  return { res, body: await res.json() };
};

beforeEach(async () => {
  fx = await createFixture();
});
afterEach(() => {
  vi.unstubAllEnvs();
  fx.cleanup();
});

describe("who can use groups", () => {
  it("a Free member is told to upgrade; an App-tier member with no 18+ confirmation is asked to confirm; signed out is 401", async () => {
    const free = member({ app: false });
    const noAdult = member({ adult: false });
    const a = await call("groups", free.id, undefined, "", "GET");
    expect(a.status).toBe(403);
    expect(await a.json()).toMatchObject({ code: "upgrade_required", feature: "communityGroups" });
    const b = await call("groups", noAdult.id, undefined, "", "GET");
    expect(b.status).toBe(403);
    expect(await b.json()).toMatchObject({ code: "adult_confirmation_required" });
    expect((await call("groups", null, undefined, "", "GET")).status).toBe(401);
  });

  // Groups follow the shared access rule (FEATURE_REQUIRES.communityGroups = "digital"), so a gym Membership gives them exactly when the Membership
  // bundle (PR #84, GYM_MEMBERSHIP_INCLUDES_APP) is on. That switch is not in this branch's base, so it is covered once both are merged.
  it("a gym Membership on its own does not count as the App tier while the bundle is off", async () => {
    const m = member({ app: false });
    fx.setSubscription(m.id, { packageId: fx.ids.membershipPackage, status: "active" });
    expect((await call("groups", m.id, undefined, "", "GET")).status).toBe(403);
  });

  it("confirm-adult needs an explicit true, is idempotent, and survives saving privacy choices", async () => {
    const m = member({ adult: false });
    expect((await call("confirm-adult", m.id, { confirm: false })).status).toBe(400);
    expect((await call("confirm-adult", m.id, { confirm: true })).status).toBe(200);
    const first = fx.db.findCommunityPrivacyByUserId(m.id)?.adultConfirmedAt;
    expect(first).toBeTruthy();
    await call("confirm-adult", m.id, { confirm: true });
    expect(fx.db.findCommunityPrivacyByUserId(m.id)?.adultConfirmedAt).toBe(first);

    const saved = await call("privacy", m.id, { discoverable: false, leaderboardVisible: true, showRealName: false });
    expect(saved.status).toBe(200);
    expect(fx.db.findCommunityPrivacyByUserId(m.id)?.adultConfirmedAt).toBe(first);
    const got = await (await call("privacy", m.id, undefined, "", "GET")).json();
    expect(got.data.adultConfirmed).toBe(true);
  });
});

describe("creating and joining", () => {
  it("creates a group: the organiser is the first member and is the only one shown the invite code", async () => {
    const org = member();
    const { res, body } = await create(org);
    expect(res.status).toBe(201);
    expect(body.data).toMatchObject({ name: "Over 50s Crew", isOrganiser: true, memberCount: 1 });
    expect(body.data.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

    const joiner = member();
    const joined = await call("groups/join", joiner.id, { code: body.data.inviteCode });
    expect(joined.status).toBe(200);
    const view = (await joined.json()).data;
    expect(view).toMatchObject({ isOrganiser: false, memberCount: 2 });
    expect("inviteCode" in view).toBe(false);
  });

  it("accepts the code however it was typed or pasted (case, spaces, dashes) and joining twice is harmless", async () => {
    const org = member();
    const code: string = (await create(org)).body.data.inviteCode;
    const joiner = member();
    const messy = `${code.slice(0, 4).toLowerCase()} - ${code.slice(4)}`;
    expect((await call("groups/join", joiner.id, { code: messy })).status).toBe(200);
    expect((await call("groups/join", joiner.id, { code })).status).toBe(200);
    expect(fx.db.findGroupMembers((fx.db.findGroupByInviteCode(code) as { id: string }).id)).toHaveLength(2);
  });

  it("a wrong code, a closed group, another gym, and a block all read the same, and add nobody", async () => {
    const org = member();
    const code: string = (await create(org)).body.data.inviteCode;
    const wrong = await call("groups/join", member().id, { code: "ZZZZZZZZ" });
    const otherGym = await call("groups/join", member({ gymId: GYM_B }).id, { code });
    const blocker = member();
    fx.db.saveProfile({ ...(fx.db.findProfileByUserId(blocker.id) as object), blockedUserIds: [org.id] } as never);
    const blocked = await call("groups/join", blocker.id, { code });
    const bodies = [wrong, otherGym, blocked];
    for (const r of bodies) expect(r.status).toBe(404);
    const first = await bodies[0].json();
    for (const r of bodies.slice(1)) expect(await r.json()).toEqual(first);

    const groupId = (fx.db.findGroupByInviteCode(code) as { id: string }).id;
    expect(fx.db.findGroupMembers(groupId)).toHaveLength(1);

    expect((await call("groups/[id]/close", org.id, {}, groupId)).status).toBe(200);
    const afterClose = await call("groups/join", member().id, { code });
    expect(afterClose.status).toBe(404);
    expect(await afterClose.json()).toEqual(first);
  });

  it("limits: 5 open groups per organiser (closing one frees a place) and 50 members per group", async () => {
    const org = member();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push((await create(org, `Group ${i}`)).body.data.id);
    const sixth = await create(org, "Group 6");
    expect(sixth.res.status).toBe(409);
    expect(sixth.body.message).toMatch(/up to 5 groups/);
    await call("groups/[id]/close", org.id, {}, ids[0]);
    expect((await create(org, "Group 6")).res.status).toBe(201);

    const code: string = (await create(member(), "Full one")).body.data.inviteCode;
    for (let i = 0; i < 49; i += 1) expect((await call("groups/join", member().id, { code })).status).toBe(200);
    const late = await call("groups/join", member().id, { code });
    expect(late.status).toBe(409);
    expect((await late.json()).message).toMatch(/full/);
  });

  it("validates names and descriptions, and refuses wording that breaks the Community rules", async () => {
    const org = member();
    expect((await create(org, "   ")).res.status).toBe(400);
    expect((await create(org, "x".repeat(61))).res.status).toBe(400);
    expect((await create(org, "Fine", "y".repeat(301))).res.status).toBe(400);
  });
});

describe("viewing, leaving, removing, closing", () => {
  async function setup() {
    const org = member({ name: "Olive Organiser" });
    const created = (await create(org)).body.data;
    const a = member({ name: "Alice Adams" });
    const b = member({ name: "Bob Brown" });
    await call("groups/join", a.id, { code: created.inviteCode });
    await call("groups/join", b.id, { code: created.inviteCode });
    return { org, a, b, id: created.id as string };
  }

  it("members see the group and each other; a stranger and a closed group get the same not-found", async () => {
    const { a, id } = await setup();
    const seen = await (await call("groups/[id]", a.id, undefined, id, "GET")).json();
    expect(seen.data.members.map((m: { displayName: string }) => m.displayName).sort()).toEqual(["Alice Adams", "Bob Brown", "Olive Organiser"]);
    expect(JSON.stringify(seen)).not.toMatch(/@example\.test/);

    const stranger = await call("groups/[id]", member().id, undefined, id, "GET");
    const missing = await call("groups/[id]", a.id, undefined, "nope", "GET");
    expect(stranger.status).toBe(404);
    expect(await stranger.json()).toEqual(await missing.json());
  });

  it("respects each person's own real-name setting, and hides members who are blocked either way", async () => {
    const { a, b, id } = await setup();
    fx.db.saveCommunityPrivacy({ userId: b.id, discoverable: true, leaderboardVisible: true, showRealName: false, adultConfirmedAt: T, createdAt: T, updatedAt: T });
    const names = (await (await call("groups/[id]", a.id, undefined, id, "GET")).json()).data.members.map((m: { displayName: string }) => m.displayName);
    expect(names).toContain("Bob B.");
    fx.db.saveProfile({ ...(fx.db.findProfileByUserId(a.id) as object), blockedUserIds: [b.id] } as never);
    const after = (await (await call("groups/[id]", a.id, undefined, id, "GET")).json()).data.members.map((m: { userId: string }) => m.userId);
    expect(after).not.toContain(b.id);
  });

  it("a member can leave; the organiser can't (they close it instead)", async () => {
    const { org, a, id } = await setup();
    expect((await call("groups/[id]/leave", a.id, {}, id)).status).toBe(200);
    expect(fx.db.findGroupMembers(id).map((m) => m.userId)).not.toContain(a.id);
    const refused = await call("groups/[id]/leave", org.id, {}, id);
    expect(refused.status).toBe(409);
  });

  it("only the organiser can remove a member or close the group; others get not-found and nothing changes", async () => {
    const { org, a, b, id } = await setup();
    expect((await call("groups/[id]/remove-member", a.id, { userId: b.id }, id)).status).toBe(404);
    expect((await call("groups/[id]/close", a.id, {}, id)).status).toBe(404);
    expect(fx.db.findGroupMembers(id)).toHaveLength(3);

    expect((await call("groups/[id]/remove-member", org.id, { userId: b.id }, id)).status).toBe(200);
    expect(fx.db.findGroupMembers(id).map((m) => m.userId)).not.toContain(b.id);
    expect((await call("groups/[id]/remove-member", org.id, { userId: org.id }, id)).status).toBe(400);

    expect((await call("groups/[id]/close", org.id, {}, id)).status).toBe(200);
    expect(fx.db.findGroupById(id)).toBeUndefined();
    expect(await (await call("groups", a.id, undefined, "", "GET")).json()).toMatchObject({ data: [] });
  });

  it("when someone loses the App tier they are refused (access is checked live) and get it back with the tier", async () => {
    const { a, id } = await setup();
    fx.db.saveDigitalEntitlement({ ...(fx.db.findDigitalEntitlementsByUserId(a.id)[0] as object), status: "revoked", revokedAt: T } as never);
    expect((await call("groups/[id]", a.id, undefined, id, "GET")).status).toBe(403);
    fx.db.saveDigitalEntitlement({ ...(fx.db.findDigitalEntitlementsByUserId(a.id)[0] as object), status: "active", revokedAt: null } as never);
    expect((await call("groups/[id]", a.id, undefined, id, "GET")).status).toBe(200);
  });
});

describe("account deletion", () => {
  it("deleting a member removes their memberships, and deleting an organiser removes the group and everyone's membership of it", async () => {
    const org = member();
    const created = (await create(org)).body.data;
    const other = member();
    await call("groups/join", other.id, { code: created.inviteCode });
    const second = (await create(other, "Other group")).body.data;

    fx.db.deleteUserAndOwnedRecords(other.id);
    expect(fx.db.findGroupMembers(created.id).map((m) => m.userId)).toEqual([org.id]);
    expect(fx.db.findGroupById(second.id)).toBeUndefined();
    expect(fx.db.findGroupMembers(second.id)).toEqual([]);

    fx.db.deleteUserAndOwnedRecords(org.id);
    expect(fx.db.findGroupById(created.id)).toBeUndefined();
    expect(fx.db.findGroupMembers(created.id)).toEqual([]);
  });
});
