// The gym community (server): a members-only feed per gym for members with a live gym Membership plus that gym's coaches and admins; members can post and
// comment, staff can post, remove anything and set challenges; reports go to that gym's staff. Real routes, real datastore file (helpers/iap-fixture.ts),
// real signed sessions and access rules. Fake ids only.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
let fx: IapFixture;
let seq = 0;

const dayOffset = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const TODAY = dayOffset(0);

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(routePath: string, userId: string | null, opts: { body?: unknown; params?: Record<string, string>; method?: string; query?: string } = {}) {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  const mod = (await import(`@/app/api/${routePath}/route`)) as Record<string, Handler>;
  const req = new NextRequest(`http://localhost/api/${routePath}${opts.query ?? ""}`, {
    method,
    headers: { "Content-Type": "application/json", ...(userId ? { Cookie: fx.cookie(userId) } : {}) },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  return mod[method](req, { params: Promise.resolve(opts.params ?? {}) });
}
const gym = (sub: string, userId: string | null, opts: Parameters<typeof call>[2] = {}) => call(`mobile/community/gym${sub}`, userId, opts);

/** A gym-A member with a live gym Membership and the 18+ confirmation, unless told otherwise. */
function member(opts: { membership?: boolean; adult?: boolean; gymId?: string | null; name?: string } = {}) {
  const { membership = true, adult = true, gymId = null, name = `Member ${seq + 1}` } = opts;
  const user = fx.db.createUserWithRole(`y${++seq}@example.test`, "x", "member", gymId);
  fx.db.saveProfile({ userId: user.id, fullName: name, email: user.email, createdAt: T, updatedAt: T } as never);
  if (membership) fx.setSubscription(user.id, { packageId: gymId ? fx.ids.gymBMembershipPackage : fx.ids.membershipPackage, status: "active" });
  if (adult) fx.db.saveCommunityPrivacy({ userId: user.id, discoverable: true, leaderboardVisible: true, showRealName: true, adultConfirmedAt: T, createdAt: T, updatedAt: T });
  return user;
}
function staff(role: "coach" | "admin", gymId: string | null = null, name = `Coach ${seq + 1}`) {
  const user = fx.db.createUserWithRole(`s${++seq}@example.test`, "x", role, gymId);
  fx.db.saveProfile({ userId: user.id, fullName: name, email: user.email, createdAt: T, updatedAt: T } as never);
  return user;
}
const post = async (who: { id: string }, text = "Open gym Saturday") => (await (await gym("", who.id, { body: { body: text } })).json()).data;

beforeEach(async () => {
  fx = await createFixture();
});
afterEach(() => fx.cleanup());

describe("who can use it", () => {
  it("a Free member and an App-tier-only member are told to upgrade; a member without the 18+ confirmation is asked to confirm; signed out is 401", async () => {
    const free = member({ membership: false });
    const appOnly = member({ membership: false });
    fx.db.saveDigitalEntitlement({
      id: `staff_grant:${appOnly.id}`, userId: appOnly.id, source: "staff_grant", status: "active", productId: null, billingOptionId: null, storeRefHash: null,
      environment: null, currentPeriodEnd: null, autoRenewing: false, grantedByUserId: null, note: null, revokedAt: null, createdAt: T, updatedAt: T,
    } as never);
    for (const m of [free, appOnly]) {
      const res = await gym("", m.id);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "upgrade_required", feature: "communityGym" });
    }
    const noAdult = await gym("", member({ adult: false }).id);
    expect(noAdult.status).toBe(403);
    expect(await noAdult.json()).toMatchObject({ code: "adult_confirmation_required" });
    expect((await gym("", null)).status).toBe(401);
  });

  it("a gym member with a live Membership, and the gym's coach and admin, can; the Membership ending ends it, and it comes back with the Membership", async () => {
    const m = member();
    expect((await gym("", m.id)).status).toBe(200);
    expect((await gym("", staff("coach").id)).status).toBe(200);
    expect((await gym("", staff("admin").id)).status).toBe(200);
    fx.setSubscription(m.id, { packageId: fx.ids.membershipPackage, status: "canceled" });
    expect((await gym("", m.id)).status).toBe(403);
    fx.setSubscription(m.id, { packageId: fx.ids.membershipPackage, status: "active" });
    expect((await gym("", m.id)).status).toBe(200);
  });

  it("an archived staff account is refused", async () => {
    const coach = staff("coach");
    fx.db.setUserArchived(coach.id, true);
    expect((await gym("", coach.id)).status).toBe(401);
  });
});

describe("posting and the feed", () => {
  it("members and staff post; the feed is newest first with who wrote it, and canRemove is true only for your own (or any, for staff)", async () => {
    const m = member({ name: "Mary Murphy" });
    const coach = staff("coach", null, "Coach Conor");
    await post(m, "First");
    await new Promise((r) => setTimeout(r, 5));
    await post(coach, "Second");
    const feed = (await (await gym("", m.id)).json()).data;
    expect(feed.posts.map((p: { body: string }) => p.body)).toEqual(["Second", "First"]);
    expect(feed.posts[0].author).toMatchObject({ displayName: "Coach Conor", isStaff: true });
    expect(feed.posts.map((p: { canRemove: boolean }) => p.canRemove)).toEqual([false, true]);
    const asCoach = (await (await gym("", coach.id)).json()).data;
    expect(asCoach.posts.every((p: { canRemove: boolean }) => p.canRemove)).toBe(true);
    expect(JSON.stringify(feed)).not.toMatch(/@example\.test/);
  });

  it("checks the text, and limits a person to 10 posts a day", async () => {
    const m = member();
    expect((await gym("", m.id, { body: { body: "  " } })).status).toBe(400);
    expect((await gym("", m.id, { body: { body: "x".repeat(1001) } })).status).toBe(400);
    for (let i = 0; i < 10; i += 1) expect((await gym("", m.id, { body: { body: `p${i}` } })).status).toBe(201);
    expect((await gym("", m.id, { body: { body: "one too many" } })).status).toBe(429);
  });

  it("members follow their own real-name setting", async () => {
    const m = member({ name: "Mary Murphy" });
    fx.db.saveCommunityPrivacy({ userId: m.id, discoverable: true, leaderboardVisible: true, showRealName: false, adultConfirmedAt: T, createdAt: T, updatedAt: T });
    await post(m);
    const feed = (await (await gym("", member().id)).json()).data;
    expect(feed.posts[0].author.displayName).toBe("Mary M.");
  });

  it("another gym never sees it, and can't touch it", async () => {
    const a = member();
    const p = await post(a, "Gym A only");
    const bMember = member({ gymId: GYM_B });
    const bCoach = staff("coach", GYM_B);
    for (const who of [bMember, bCoach]) {
      expect((await (await gym("", who.id)).json()).data.posts).toEqual([]);
      expect((await gym("/posts/[postId]/remove", who.id, { body: {}, params: { postId: p.id } })).status).toBe(404);
      expect((await gym("/posts/[postId]/comments", who.id, { params: { postId: p.id } })).status).toBe(404);
      expect((await gym("/posts/[postId]/comments", who.id, { body: { body: "hi" }, params: { postId: p.id } })).status).toBe(404);
    }
    expect(fx.db.findGymPostById(p.id)?.removedAt).toBeNull();
  });

  it("hides posts from members blocked either way, but never your own", async () => {
    const a = member();
    const b = member();
    await post(b, "From Bob");
    await post(a, "From Alice");
    fx.db.saveProfile({ ...(fx.db.findProfileByUserId(a.id) as object), blockedUserIds: [b.id] } as never);
    expect((await (await gym("", a.id)).json()).data.posts.map((p: { body: string }) => p.body)).toEqual(["From Alice"]);
    // Either way: Bob can't see Alice's post either, because Alice blocked him.
    expect((await (await gym("", b.id)).json()).data.posts.map((p: { body: string }) => p.body)).toEqual(["From Bob"]);
  });
});

describe("removing", () => {
  it("authors remove their own; other members can't (not found); a coach removes anything in the gym", async () => {
    const a = member();
    const b = member();
    const coach = staff("coach");
    const p1 = await post(a, "mine");
    const p2 = await post(b, "bobs");
    expect((await gym("/posts/[postId]/remove", b.id, { body: {}, params: { postId: p1.id } })).status).toBe(404);
    expect((await gym("/posts/[postId]/remove", a.id, { body: {}, params: { postId: p1.id } })).status).toBe(200);
    expect((await gym("/posts/[postId]/remove", coach.id, { body: {}, params: { postId: p2.id } })).status).toBe(200);
    expect((await (await gym("", a.id)).json()).data.posts).toEqual([]);
    expect((await gym("/posts/[postId]/remove", a.id, { body: {}, params: { postId: p1.id } })).status).toBe(404);
  });
});

describe("comments", () => {
  it("members and staff comment; oldest first; own or staff can remove; checks the text; blocked authors hidden", async () => {
    const a = member();
    const b = member();
    const coach = staff("coach", null, "Coach Conor");
    const p = await post(a);
    const params = { postId: p.id };
    expect((await gym("/posts/[postId]/comments", b.id, { body: { body: "  " }, params })).status).toBe(400);
    const c1 = (await (await gym("/posts/[postId]/comments", b.id, { body: { body: "See you there" }, params })).json()).data;
    await new Promise((r) => setTimeout(r, 5));
    await gym("/posts/[postId]/comments", coach.id, { body: { body: "Doors at 9" }, params });
    const list = (await (await gym("/posts/[postId]/comments", a.id, { params })).json()).data;
    expect(list.map((c: { body: string }) => c.body)).toEqual(["See you there", "Doors at 9"]);
    expect(list[1].author.isStaff).toBe(true);
    expect((await gym("", a.id)).status).toBe(200);
    expect((await (await gym("", a.id)).json()).data.posts[0].commentCount).toBe(2);

    expect((await gym("/comments/[commentId]/remove", a.id, { body: {}, params: { commentId: c1.id } })).status).toBe(404);
    fx.db.saveProfile({ ...(fx.db.findProfileByUserId(a.id) as object), blockedUserIds: [b.id] } as never);
    expect((await (await gym("/posts/[postId]/comments", a.id, { params })).json()).data.map((c: { body: string }) => c.body)).toEqual(["Doors at 9"]);
    expect((await gym("/comments/[commentId]/remove", coach.id, { body: {}, params: { commentId: c1.id } })).status).toBe(200);
    expect((await gym("/comments/[commentId]/remove", b.id, { body: {}, params: { commentId: c1.id } })).status).toBe(404);
  });
});

describe("reports", () => {
  it("a member reports a post; staff of that gym see it with the text and resolve it (removes) or dismiss it; other gyms and members can't", async () => {
    const a = member();
    const reporter = member();
    const coach = staff("coach");
    const p = await post(a, "Something rude");
    const report = (body: unknown) => gym("/report", reporter.id, { body });
    expect((await report({ targetType: "post", targetId: p.id, reason: "  " })).status).toBe(400);
    expect((await report({ targetType: "post", targetId: p.id, reason: "Rude" })).status).toBe(201);
    await report({ targetType: "post", targetId: p.id, reason: "Rude" });
    expect(fx.db.findGymReports(null, "open")).toHaveLength(1);

    const listed = (await (await call("staff/community/gym-reports", coach.id)).json()).data;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ targetType: "post", text: "Something rude", reason: "Rude", alreadyRemoved: false });
    expect((await call("staff/community/gym-reports", staff("coach", GYM_B).id)).status).toBe(200);
    expect((await (await call("staff/community/gym-reports", staff("coach", GYM_B).id)).json()).data).toEqual([]);
    expect((await call("staff/community/gym-reports", reporter.id)).status).toBe(403);

    const id = listed[0].id;
    const otherGym = await call("staff/community/gym-reports/[id]/resolve", staff("admin", GYM_B).id, { body: { action: "resolve" }, params: { id } });
    expect(otherGym.status).toBe(404);
    expect((await call("staff/community/gym-reports/[id]/resolve", coach.id, { body: { action: "resolve" }, params: { id } })).status).toBe(200);
    expect(fx.db.findGymPostById(p.id)?.removedAt).toBeTruthy();
    expect((await call("staff/community/gym-reports/[id]/resolve", coach.id, { body: { action: "resolve" }, params: { id } })).status).toBe(404);
  });

  it("dismissing leaves the post; reporting a comment works; you can't report what you can't see", async () => {
    const a = member();
    const reporter = member();
    const coach = staff("coach");
    const p = await post(a);
    const c = (await (await gym("/posts/[postId]/comments", a.id, { body: { body: "meh" }, params: { postId: p.id } })).json()).data;
    expect((await gym("/report", reporter.id, { body: { targetType: "comment", targetId: c.id, reason: "Unkind" } })).status).toBe(201);
    const [r] = fx.db.findGymReports(null, "open");
    expect((await call("staff/community/gym-reports/[id]/resolve", coach.id, { body: { action: "dismiss" }, params: { id: r.id } })).status).toBe(200);
    expect(fx.db.findGymCommentById(c.id)?.removedAt).toBeNull();
    expect((await gym("/report", member({ gymId: GYM_B }).id, { body: { targetType: "post", targetId: p.id, reason: "x" } })).status).toBe(404);
  });
});

describe("gym challenges", () => {
  const mk = (who: { id: string }, over: Record<string, unknown> = {}) =>
    gym("/challenges", who.id, { body: { title: "November volume", metric: "volume", startDate: TODAY, endDate: dayOffset(6), ...over } });
  let wk = 0;
  const train = (userId: string, date: string, weight: number) =>
    fx.db.saveWorkoutSession({
      id: `gw${++wk}`, userId, date, title: "S", exercises: [{ exerciseId: null, name: "Row", weight: String(weight), reps: 10, sets: 3 }], runs: [], createdAt: T, updatedAt: T,
    } as never);

  it("any coach or admin sets one; members can't; the same date and limit rules apply", async () => {
    const coach = staff("coach");
    const created = await mk(coach);
    expect(created.status).toBe(201);
    expect((await created.json()).data).toMatchObject({ title: "November volume", status: "active" });
    expect((await mk(staff("admin"), { title: "Second" })).status).toBe(201);
    expect((await mk(member())).status).toBe(403);
    expect((await mk(coach, { startDate: dayOffset(-1) })).status).toBe(400);
    expect((await mk(coach, { metric: "steps" })).status).toBe(400);
    for (let i = 0; i < 3; i += 1) await mk(coach, { title: `C${i}` });
    expect((await mk(coach, { title: "Sixth" })).status).toBe(409);
  });

  it("members and staff see it; standings rank only gym members with a live Membership (staff are not ranked), scored inside the dates", async () => {
    const coach = staff("coach");
    const alice = member({ name: "Alice" });
    const bob = member({ name: "Bob" });
    const lapsed = member({ name: "Lapsed", membership: false });
    const c = (await (await mk(coach)).json()).data;
    train(alice.id, dayOffset(1), 50); // 1500
    train(bob.id, dayOffset(2), 100); // 3000
    train(bob.id, dayOffset(-4), 900); // before the dates
    train(lapsed.id, dayOffset(1), 500); // no live Membership: not in the gym standings
    train(coach.id, dayOffset(1), 500); // staff are not ranked
    const params = { challengeId: c.id };
    const asAlice = (await (await gym("/challenges/[challengeId]", alice.id, { params })).json()).data;
    expect(asAlice.entries.map((e: { displayName: string; value: number }) => [e.displayName, e.value])).toEqual([["Bob", 3000], ["Alice", 1500]]);
    expect(asAlice.iAmHidden).toBe(false);
    const asCoach = await gym("/challenges/[challengeId]", coach.id, { params });
    expect(asCoach.status).toBe(200);
    expect((await asCoach.json()).data.iAmHidden).toBe(false);
    expect((await (await gym("/challenges", alice.id)).json()).data).toHaveLength(1);
  });

  it("another gym's staff and members see none of it; only the setter or an admin can cancel", async () => {
    const coach = staff("coach");
    const other = staff("coach");
    const alice = member();
    const c = (await (await mk(coach)).json()).data;
    const params = { challengeId: c.id };
    for (const who of [member({ gymId: GYM_B }), staff("coach", GYM_B)]) {
      expect((await gym("/challenges/[challengeId]", who.id, { params })).status).toBe(404);
      expect((await gym("/challenges/[challengeId]/cancel", who.id, { body: {}, params })).status).toBe(404);
      expect((await (await gym("/challenges", who.id)).json()).data).toEqual([]);
    }
    expect((await gym("/challenges/[challengeId]/cancel", alice.id, { body: {}, params })).status).toBe(404);
    expect((await gym("/challenges/[challengeId]/cancel", other.id, { body: {}, params })).status).toBe(404); // a different coach
    expect((await gym("/challenges/[challengeId]/cancel", staff("admin").id, { body: {}, params })).status).toBe(200);
    expect((await gym("/challenges/[challengeId]/cancel", coach.id, { body: {}, params })).status).toBe(409);
    expect((await (await gym("/challenges/[challengeId]", alice.id, { params })).json()).data.challenge.status).toBe("canceled");
  });
});

describe("account deletion", () => {
  it("deleting a member removes their posts (and the comments on them), their comments and their reports", async () => {
    const a = member();
    const b = member();
    const p = await post(a, "Mine");
    const other = await post(b, "Bobs");
    await gym("/posts/[postId]/comments", b.id, { body: { body: "on a's post" }, params: { postId: p.id } });
    await gym("/posts/[postId]/comments", a.id, { body: { body: "on b's post" }, params: { postId: other.id } });
    await gym("/report", a.id, { body: { targetType: "post", targetId: other.id, reason: "x" } });

    fx.db.deleteUserAndOwnedRecords(a.id);
    expect(fx.db.findGymPostById(p.id)).toBeUndefined();
    expect(fx.db.findGymCommentsByPostId(p.id)).toEqual([]);
    expect(fx.db.findGymCommentsByPostId(other.id)).toEqual([]);
    expect(fx.db.findGymReports(null)).toEqual([]);
    expect(fx.db.findGymPostById(other.id)).toBeDefined();
  });
});
