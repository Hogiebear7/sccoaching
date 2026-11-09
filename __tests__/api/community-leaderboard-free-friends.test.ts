// GET /api/mobile/community/leaderboard: free for every member, with a Friends scope (owner decisions 2026-11-08). Real route, real datastore
// (helpers/iap-fixture.ts), real signed sessions. Fake ids only.
// What this proves: a member with no plan at all can read it; with no follows the default is the whole gym; once the member follows someone the default is
// friends (the people followed plus the member), with the switch to global; explicit scopes win; followed people in another gym, blocked either way, or
// who switched their leaderboard off never appear or count.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
const today = () => new Date().toISOString().slice(0, 10);
let fx: IapFixture;
let seq = 0;

async function board(userId: string, query = "") {
  const mod = (await import("@/app/api/mobile/community/leaderboard/route")) as { GET: (req: NextRequest) => Promise<Response> };
  const res = await mod.GET(new NextRequest(`http://localhost/api/mobile/community/leaderboard?metric=volume&range=all${query}`, { headers: { Cookie: fx.cookie(userId) } }));
  return { status: res.status, body: await res.json() };
}

/** A gym member (no plan at all) who has lifted `kg` of volume. */
function person(name: string, kg: number, gymId: string | null = null) {
  const user = fx.db.createUserWithRole(`lb${++seq}@example.test`, "x", "member", gymId);
  fx.db.saveProfile({ userId: user.id, fullName: name, email: user.email, primaryGoal: "General Health", createdAt: T, updatedAt: T } as never);
  fx.db.saveWorkoutSession({
    id: `w${seq}`,
    userId: user.id,
    date: today(),
    title: "Session",
    durationMins: 30,
    notes: null,
    sessionRpe: null,
    exercises: [{ exerciseId: null, name: "Squat", weight: String(kg), reps: 1, sets: 1 }],
    runs: [],
    createdAt: T,
    updatedAt: T,
  } as never);
  return user;
}

const names = (b: { data: { entries: { displayName: string }[] } }) => b.data.entries.map((e) => e.displayName);

beforeEach(async () => {
  fx = await createFixture();
});
afterEach(() => fx.cleanup());

describe("the leaderboard is free", () => {
  it("a member with no plan reads it (it used to be 403 for anyone without the App subscription)", async () => {
    const me = person("Free Me", 100);
    const r = await board(me.id);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  });

  it("signed out is still 401", async () => {
    const mod = (await import("@/app/api/mobile/community/leaderboard/route")) as { GET: (req: NextRequest) => Promise<Response> };
    expect((await mod.GET(new NextRequest("http://localhost/api/mobile/community/leaderboard"))).status).toBe(401);
  });
});

describe("scopes", () => {
  it("with no follows the default is the whole gym, and it says nobody is followed", async () => {
    const me = person("Me", 100);
    person("Stranger", 300);
    const r = await board(me.id);
    expect(r.body.data).toMatchObject({ scope: "global", followingCount: 0, myUserId: me.id });
    expect(names(r.body)).toEqual(["Stranger", "Me"]);
  });

  it("once the member follows someone the default is friends: the people followed plus the member, not the rest of the gym", async () => {
    const me = person("Me", 100);
    const friend = person("Friend", 200);
    person("Stranger", 300);
    fx.db.followUser(me.id, friend.id);
    const r = await board(me.id);
    expect(r.body.data).toMatchObject({ scope: "friends", followingCount: 1 });
    expect(names(r.body)).toEqual(["Friend", "Me"]);
  });

  it("the member can switch to global, or force friends, whatever the default would be", async () => {
    const me = person("Me", 100);
    const friend = person("Friend", 200);
    person("Stranger", 300);
    fx.db.followUser(me.id, friend.id);
    const global = await board(me.id, "&scope=global");
    expect(global.body.data.scope).toBe("global");
    expect(names(global.body)).toEqual(["Stranger", "Friend", "Me"]);
    const lonely = person("Lonely", 50);
    const forced = await board(lonely.id, "&scope=friends");
    expect(forced.body.data).toMatchObject({ scope: "friends", followingCount: 0 });
    expect(names(forced.body)).toEqual(["Lonely"]);
  });

  it("an unknown scope falls back to the automatic choice", async () => {
    const me = person("Me", 100);
    const friend = person("Friend", 200);
    fx.db.followUser(me.id, friend.id);
    expect((await board(me.id, "&scope=everything")).body.data.scope).toBe("friends");
  });
});

describe("who a friends board can show", () => {
  it("never a followed member from another gym", async () => {
    const me = person("Me", 100);
    const away = person("Other Gym", 500, GYM_B);
    fx.db.followUser(me.id, away.id);
    const r = await board(me.id);
    expect(r.body.data).toMatchObject({ scope: "global", followingCount: 0 });
    expect(names(r.body)).not.toContain("Other Gym");
  });

  it("never a followed member who blocked the viewer, and they do not count as someone followed", async () => {
    const me = person("Me", 100);
    const friend = person("Friend", 200);
    fx.db.followUser(me.id, friend.id);
    // A block lives on the blocker's own profile.
    fx.db.saveProfile({ userId: friend.id, fullName: "Friend", email: friend.email, primaryGoal: "General Health", blockedUserIds: [me.id], createdAt: T, updatedAt: T } as never);
    const r = await board(me.id);
    expect(r.body.data).toMatchObject({ scope: "global", followingCount: 0 });
    expect(names(r.body)).not.toContain("Friend");
  });

  it("a friend who switched their leaderboard off is left out of the ranking", async () => {
    const me = person("Me", 100);
    const friend = person("Friend", 200);
    fx.db.followUser(me.id, friend.id);
    fx.db.saveCommunityPrivacy({ userId: friend.id, discoverable: true, leaderboardVisible: false, showRealName: true, communityOptIn: false, adultConfirmedAt: null, createdAt: T, updatedAt: T } as never);
    const r = await board(me.id);
    expect(names(r.body)).toEqual(["Me"]);
  });
});
