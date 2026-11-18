// GET /api/mobile/community/leaderboard?scope=gym: the gym community board. Only members of the caller's gym who hold a live gym Membership are ranked, and
// only a member with a gym Membership of their own may ask for it. Real route, real datastore (helpers/iap-fixture.ts), real signed sessions. Fake ids only.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
const today = () => new Date().toISOString().slice(0, 10);
let fx: IapFixture;
let seq = 0;

async function board(userId: string, query = "") {
  const mod = (await import("@/app/api/mobile/community/leaderboard/route")) as { GET: (req: NextRequest) => Promise<Response> };
  const res = await mod.GET(new NextRequest(`http://localhost/api/mobile/community/leaderboard?metric=volume&range=all${query}`, { headers: { Cookie: fx.cookie(userId) } }));
  return { status: res.status, body: await res.json() };
}

/** A member who has lifted `kg` of volume, with or without a live gym Membership. */
function person(name: string, kg: number, opts: { membership?: boolean } = {}) {
  const user = fx.db.createUserWithRole(`gc${++seq}@example.test`, "x", "member", null);
  fx.db.saveProfile({ userId: user.id, fullName: name, email: user.email, primaryGoal: "General Health", createdAt: T, updatedAt: T } as never);
  fx.db.saveWorkoutSession({
    id: `gw${seq}`,
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
  if (opts.membership) fx.setSubscription(user.id, { packageId: fx.ids.membershipPackage, status: "active" });
  return user;
}

const names = (b: { data: { entries: { displayName: string }[] } }) => b.data.entries.map((e) => e.displayName);

beforeEach(async () => {
  fx = await createFixture();
});
afterEach(() => fx.cleanup());

describe("scope=gym", () => {
  it("ranks only the gym's members with a live gym Membership, and says it used the gym scope", async () => {
    const me = person("Me", 100, { membership: true });
    person("Gym Mate", 300, { membership: true });
    person("App Only", 900); // in the gym's area but with no gym Membership
    const lapsed = person("Lapsed", 800, { membership: true });
    fx.setSubscription(lapsed.id, { packageId: fx.ids.membershipPackage, status: "canceled" });

    const r = await board(me.id, "&scope=gym");
    expect(r.status).toBe(200);
    expect(r.body.data.scope).toBe("gym");
    expect(names(r.body)).toEqual(["Gym Mate", "Me"]);
  });

  it("Everyone still ranks everybody, so the two boards differ", async () => {
    const me = person("Me", 100, { membership: true });
    person("App Only", 900);
    const r = await board(me.id, "&scope=global");
    expect(r.body.data.scope).toBe("global");
    expect(names(r.body)).toEqual(["App Only", "Me"]);
  });

  it("a member without a gym Membership cannot ask for the gym board (403, same as the gym community)", async () => {
    const me = person("App Only Me", 100);
    person("Gym Mate", 300, { membership: true });
    const r = await board(me.id, "&scope=gym");
    expect(r.status).toBe(403);
    expect(r.body.success).toBe(false);
  });

  it("the default is never the gym board, even for a gym member", async () => {
    const me = person("Me", 100, { membership: true });
    person("Gym Mate", 300, { membership: true });
    const r = await board(me.id);
    expect(r.body.data.scope).toBe("global");
  });

  it("a member who switched their leaderboard off stays off the gym board too", async () => {
    const me = person("Me", 100, { membership: true });
    const hidden = person("Hidden", 500, { membership: true });
    fx.db.saveCommunityPrivacy({ userId: hidden.id, discoverable: true, leaderboardVisible: false, showRealName: true, communityOptIn: false, adultConfirmedAt: null, createdAt: T, updatedAt: T } as never);
    const r = await board(me.id, "&scope=gym");
    expect(names(r.body)).toEqual(["Me"]);
  });
});
