// Community notifications: a coach's gym post, a comment on your gym post, and challenges starting and finishing. Real routes, real datastore
// (helpers/iap-fixture.ts), real signed sessions, the real housekeeping job. Fake ids only. PUSH_ENABLED=false so nothing leaves the process.
// What this proves: a coach's post reaches the gym's members who can open the gym community (live Membership and 18+ confirmed), not the author, not
// people blocked either way, not another gym, and a member's post tells nobody; a comment tells the post's author (not on your own post); the challenge job
// tells each person once however often it runs, only inside the start and finish windows, never for a canceled challenge or a closed group, and a gym
// challenge reaches the gym's members.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
let fx: IapFixture;
let seq = 0;

const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(path: string, userId: string, body?: unknown, params: Record<string, string> = {}, method = "POST") {
  const mod = (await import(`@/app/api/mobile/community/${path}/route`)) as Record<string, Handler>;
  return mod[method](
    new NextRequest(`http://localhost/api/mobile/community/${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: fx.cookie(userId) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve(params) }
  );
}

function person(opts: { membership?: boolean; app?: boolean; adult?: boolean; gymId?: string | null; name?: string; role?: "member" | "coach" } = {}) {
  const { membership = true, app = false, adult = true, gymId = null, name = `Person ${seq + 1}`, role = "member" } = opts;
  const user = fx.db.createUserWithRole(`n${++seq}@example.test`, "x", role, gymId);
  fx.db.saveProfile({ userId: user.id, fullName: name, email: user.email, createdAt: T, updatedAt: T } as never);
  if (role === "member" && membership) {
    fx.setSubscription(user.id, { packageId: gymId ? fx.ids.gymBMembershipPackage : fx.ids.membershipPackage, status: "active" });
  }
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

const inbox = (userId: string, type?: string) => fx.db.findNotificationsByUserId(userId).filter((n) => !type || n.type === type);

beforeEach(async () => {
  vi.stubEnv("PUSH_ENABLED", "false");
  fx = await createFixture();
});
afterEach(() => {
  vi.unstubAllEnvs();
  fx.cleanup();
});

describe("a post in the gym feed", () => {
  it("a coach's post tells the gym's members who can open the gym community, and only them", async () => {
    const coach = person({ role: "coach", name: "Coach Cathy" });
    const inGym = person({ name: "In Gym" });
    const noAdult = person({ adult: false });
    const noMembership = person({ membership: false });
    const otherGym = person({ gymId: GYM_B });

    const res = await call("gym", coach.id, { body: "Class moved to 7pm tonight" });
    expect(res.status).toBe(201);

    const got = inbox(inGym.id, "gym_post");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ title: "Coach Cathy posted in your gym's community", body: "Class moved to 7pm tonight", linkHref: "/community/gym" });
    for (const nobody of [noAdult, noMembership, otherGym, coach]) expect(inbox(nobody.id, "gym_post")).toEqual([]);
  });

  it("a member's own post tells nobody", async () => {
    const poster = person({ name: "Pat Poster" });
    const other = person();
    expect((await call("gym", poster.id, { body: "Anyone fancy a run?" })).status).toBe(201);
    expect(inbox(other.id, "gym_post")).toEqual([]);
  });

  it("a member who blocked the coach is not told", async () => {
    const coach = person({ role: "coach" });
    const blocker = person();
    fx.db.saveProfile({ userId: blocker.id, fullName: "Blocker", email: blocker.email, blockedUserIds: [coach.id], createdAt: T, updatedAt: T } as never);
    await call("gym", coach.id, { body: "Hello gym" });
    expect(inbox(blocker.id, "gym_post")).toEqual([]);
  });
});

describe("a comment on a gym post", () => {
  async function postBy(userId: string) {
    const res = await call("gym", userId, { body: "My PB today" });
    return (await res.json()).data.id as string;
  }
  const comment = (userId: string, postId: string, text: string) => call("gym/posts/[postId]/comments", userId, { body: text }, { postId });

  it("tells the post's author, with the commenter's name and a short preview", async () => {
    const author = person({ name: "Ann Author" });
    const fan = person({ name: "Fay Fan" });
    const postId = await postBy(author.id);
    expect((await comment(fan.id, postId, "Well done!")).status).toBe(201);
    const got = inbox(author.id, "gym_comment");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ title: "Fay Fan commented on your post", body: "Well done!", linkHref: "/community/gym" });
  });

  it("does not tell you about a comment on your own post by yourself, nor from someone you blocked", async () => {
    const author = person();
    const blocked = person();
    fx.db.saveProfile({ userId: author.id, fullName: "Author", email: author.email, blockedUserIds: [blocked.id], createdAt: T, updatedAt: T } as never);
    const postId = await postBy(author.id);
    await comment(author.id, postId, "Thanks all");
    await comment(blocked.id, postId, "Nice one");
    expect(inbox(author.id, "gym_comment")).toEqual([]);
  });
});

describe("the challenge job", () => {
  async function run() {
    const { notifyCommunityChallengesJob } = await import("@/lib/jobs/notify-community-challenges");
    return notifyCommunityChallengesJob.run();
  }

  async function groupWith(...members: { id: string }[]) {
    const organiser = person({ membership: false, app: true, name: "Org" });
    const g = await (await call("groups", organiser.id, { name: "Crew", description: "" })).json();
    for (const m of members) expect((await call("groups/join", m.id, { code: g.data.inviteCode })).status).toBe(200);
    return { organiser, groupId: g.data.id as string };
  }

  function challenge(scopeType: "group" | "gym", scopeId: string, over: Record<string, unknown> = {}) {
    const record = {
      id: `ch-${++seq}`, scopeType, scopeId, createdBy: "someone", title: "November volume", metric: "volume",
      startDate: isoDay(0), endDate: isoDay(20), canceledAt: null, createdAt: T, ...over,
    };
    expect(fx.db.createChallengeIfUnderLimit(record as never, 99, isoDay(0)).ok).toBe(true);
    return record;
  }

  it("tells every group member (organiser included) a challenge has started, once however often the job runs", async () => {
    const a = person({ membership: false, app: true });
    const b = person({ membership: false, app: true });
    const { organiser, groupId } = await groupWith(a, b);
    challenge("group", groupId);
    await run();
    await run();
    await run();
    for (const u of [a, b, organiser]) {
      const got = inbox(u.id, "challenge_started");
      expect(got).toHaveLength(1);
      expect(got[0].title).toBe("Challenge started: November volume");
      expect(got[0].linkHref).toContain(`/community/challenge?scope=group&groupId=${groupId}&challengeId=ch-`);
    }
  });

  it("tells them it has finished once it is over, inside a 3-day window", async () => {
    const a = person({ membership: false, app: true });
    const { groupId } = await groupWith(a);
    challenge("group", groupId, { startDate: isoDay(-14), endDate: isoDay(-1) });
    await run();
    await run();
    expect(inbox(a.id, "challenge_ended")).toHaveLength(1);
    expect(inbox(a.id, "challenge_ended")[0].title).toBe("Challenge finished: November volume");
    expect(inbox(a.id, "challenge_started")).toEqual([]);
  });

  it("is silent about anything outside the windows, canceled, upcoming, or in a closed group", async () => {
    const a = person({ membership: false, app: true });
    const { organiser, groupId } = await groupWith(a);
    challenge("group", groupId, { startDate: isoDay(-30), endDate: isoDay(-10) }); // ended long ago
    challenge("group", groupId, { startDate: isoDay(-10), endDate: isoDay(10) }); // started long ago
    challenge("group", groupId, { startDate: isoDay(5), endDate: isoDay(15) }); // not started yet
    challenge("group", groupId, { canceledAt: new Date().toISOString() }); // canceled
    await run();
    expect(inbox(a.id)).toEqual([]);

    challenge("group", groupId, { title: "Starts today" });
    expect((await call("groups/[id]/close", organiser.id, undefined, { id: groupId })).status).toBe(200);
    await run();
    expect(inbox(a.id)).toEqual([]);
  });

  it("a gym challenge reaches the gym's members who can open the gym community, not other gyms", async () => {
    const inGym = person();
    const noAdult = person({ adult: false });
    const otherGym = person({ gymId: GYM_B });
    challenge("gym", "primary", { title: "Gym deadlift week", metric: "deadlift" });
    await run();
    const got = inbox(inGym.id, "challenge_started");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ title: "Challenge started: Gym deadlift week", linkHref: expect.stringContaining("/community/challenge?scope=gym&challengeId=ch-") });
    expect(inbox(noAdult.id)).toEqual([]);
    expect(inbox(otherGym.id)).toEqual([]);
  });
});
