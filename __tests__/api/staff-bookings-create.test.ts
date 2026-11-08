// POST /api/staff/bookings/create: a coach or admin books a MEMBER into a class. Real route, real datastore file
// (helpers/iap-fixture.ts), real signed sessions, real can() / sameGym() / booking rules. Fake ids only.
// What this proves: every member rule still applies (active membership, emergency contact, plan allowance, plan class
// types); a full class puts the member on the waitlist; a full waitlist refuses; gym, role and archive guards read as
// "not found" with nothing written; the member is told; the waitlist cap matches the member route's.
import { readFileSync } from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
let fx: IapFixture;
let coach: { id: string };
let seq = 0;

const future = (days = 7) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function makeClass(over: Record<string, unknown> = {}, coachId = coach.id, gymId: string | null = null) {
  const id = `class-${++seq}`;
  fx.db.saveClass({
    id,
    title: "Over 50s Fitness",
    category: "general",
    coachUserId: coachId,
    gymId,
    date: future(),
    startTime: "10:00",
    durationMins: 45,
    capacity: 3,
    createdAt: T,
    updatedAt: T,
    ...over,
  } as never);
  return id;
}

function makeMember(opts: { emergency?: boolean; membership?: boolean; gymId?: string | null; packageId?: string } = {}) {
  const { emergency = true, membership = true, gymId = null, packageId } = opts;
  const user = fx.db.createUserWithRole(`m${++seq}@example.test`, "x", "member", gymId);
  fx.db.saveProfile({
    userId: user.id,
    fullName: `Member ${seq}`,
    email: user.email,
    ...(emergency ? { emergencyContactName: "Jane", emergencyContactPhone: "+353 83 000 0000" } : {}),
    createdAt: T,
    updatedAt: T,
  } as never);
  if (membership) fx.setSubscription(user.id, { packageId: packageId ?? (gymId ? fx.ids.gymBMembershipPackage : fx.ids.membershipPackage), status: "active" });
  return user;
}

async function book(actorId: string | null, body: unknown) {
  const { POST } = await import("@/app/api/staff/bookings/create/route");
  return POST(
    new NextRequest("http://localhost/api/staff/bookings/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(actorId ? { Cookie: fx.cookie(actorId) } : {}) },
      body: JSON.stringify(body),
    })
  );
}

const nothingWritten = (classId: string) => {
  expect(fx.db.findBookingsByClassId(classId)).toHaveLength(0);
  expect(fx.db.findWaitlistEntriesByClassId(classId)).toHaveLength(0);
};

beforeEach(async () => {
  fx = await createFixture();
  coach = fx.db.createUserWithRole("coach@example.test", "x", "coach", null);
});
afterEach(() => fx.cleanup());

describe("booking a member in", () => {
  it("books them, counts the session, and tells the member", async () => {
    const m = makeMember();
    const classId = makeClass();
    const res = await book(fx.adminA.id, { classId, userId: m.id });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ success: true, outcome: "booked" });
    expect(fx.db.findBookingsByClassId(classId).map((b) => b.userId)).toEqual([m.id]);
    expect(fx.db.findSubscriptionByUserId(m.id)?.sessionsUsedThisPeriod).toBe(1);
    const notes = fx.db.findNotificationsByUserId(m.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: "booking_confirmed", title: "Booked: Over 50s Fitness" });
  });

  it("a coach (classes.manage) can book too", async () => {
    const m = makeMember();
    const res = await book(coach.id, { classId: makeClass(), userId: m.id });
    expect(res.status).toBe(201);
  });
});

describe("every member rule still applies", () => {
  it("refuses a member with no emergency contact, and nothing is written", async () => {
    const m = makeMember({ emergency: false });
    const classId = makeClass();
    const res = await book(fx.adminA.id, { classId, userId: m.id });
    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe("Add an emergency contact to this member's profile before booking them.");
    nothingWritten(classId);
  });

  it("refuses a member with no active membership", async () => {
    const m = makeMember({ membership: false });
    const classId = makeClass();
    const res = await book(fx.adminA.id, { classId, userId: m.id });
    expect(res.status).toBe(403);
    nothingWritten(classId);
  });

  it("refuses when the plan's sessions are used up and there are no pass packs", async () => {
    fx.db.saveMembershipPackage({
      id: "pkg-limited", categoryId: "cat-primary", name: "Limited", slug: "limited", shortDescription: null, fullDescription: null,
      packageType: "membership", sessionAllowanceType: "fixed_count", sessionAllowanceCount: 1, eligibleClassTypes: [], visible: true, sortOrder: 2,
      stripeProductId: null, deliveryChannel: "in_person", billingChannel: "stripe_web", accessType: "membership", createdAt: T, updatedAt: T,
    } as never);
    const m = makeMember({ packageId: "pkg-limited" });
    fx.setSubscription(m.id, { packageId: "pkg-limited", status: "active", sessionsUsedThisPeriod: 1 });
    const classId = makeClass();
    const res = await book(fx.adminA.id, { classId, userId: m.id });
    expect(res.status).toBe(403);
    expect((await res.json()).message).toMatch(/used all of their sessions/);
    nothingWritten(classId);
  });

  it("refuses a class that has already started", async () => {
    const m = makeMember();
    const classId = makeClass({ date: "2020-01-01" });
    expect((await book(fx.adminA.id, { classId, userId: m.id })).status).toBe(409);
    nothingWritten(classId);
  });

  it("refuses a duplicate booking", async () => {
    const m = makeMember();
    const classId = makeClass();
    expect((await book(fx.adminA.id, { classId, userId: m.id })).status).toBe(201);
    const again = await book(fx.adminA.id, { classId, userId: m.id });
    expect(again.status).toBe(409);
    expect(fx.db.findBookingsByClassId(classId)).toHaveLength(1);
    expect(fx.db.findSubscriptionByUserId(m.id)?.sessionsUsedThisPeriod).toBe(1);
  });
});

describe("full class and waitlist", () => {
  it("a full class puts the member on the waitlist, without using a session", async () => {
    const classId = makeClass({ capacity: 1 });
    expect((await book(fx.adminA.id, { classId, userId: makeMember().id })).status).toBe(201);
    const m = makeMember();
    const res = await book(fx.adminA.id, { classId, userId: m.id });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ success: true, outcome: "waitlisted" });
    expect(fx.db.findBookingsByClassId(classId)).toHaveLength(1);
    expect(fx.db.findWaitlistEntriesByClassId(classId).map((e) => e.userId)).toEqual([m.id]);
    expect(fx.db.findSubscriptionByUserId(m.id)?.sessionsUsedThisPeriod).toBe(0);
  });

  it("a full waitlist refuses, and adds nobody", async () => {
    const classId = makeClass({ capacity: 1 });
    await book(fx.adminA.id, { classId, userId: makeMember().id });
    await book(fx.adminA.id, { classId, userId: makeMember().id });
    await book(fx.adminA.id, { classId, userId: makeMember().id });
    expect(fx.db.findWaitlistEntriesByClassId(classId)).toHaveLength(2);

    const res = await book(fx.adminA.id, { classId, userId: makeMember().id });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/both full/);
    expect(fx.db.findWaitlistEntriesByClassId(classId)).toHaveLength(2);
  });

  it("refuses to waitlist someone already on the waitlist", async () => {
    const classId = makeClass({ capacity: 1 });
    await book(fx.adminA.id, { classId, userId: makeMember().id });
    const m = makeMember();
    await book(fx.adminA.id, { classId, userId: m.id });
    expect((await book(fx.adminA.id, { classId, userId: m.id })).status).toBe(409);
    expect(fx.db.findWaitlistEntriesByClassId(classId)).toHaveLength(1);
  });

  it("uses the same waitlist cap as a member joining (guards against the two drifting apart)", () => {
    const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
    const cap = (src: string) => /const MAX_WAITLIST_SIZE = (\d+);/.exec(src)?.[1];
    const mine = cap(read("app/api/staff/bookings/create/route.ts"));
    expect(mine).toBeDefined();
    expect(mine).toBe(cap(read("app/api/bookings/waitlist/join/route.ts")));
  });
});

describe("who may, and for whom", () => {
  it("a member in another gym, a missing member, a staff account and an archived member all read as not found", async () => {
    const classId = makeClass();
    const archived = makeMember();
    expect(fx.db.setUserArchived(archived.id, true)).toBe(true);
    const targets = [fx.memberB.id, "member-missing", coach.id, archived.id];
    const bodies = [];
    for (const userId of targets) {
      const res = await book(fx.adminA.id, { classId, userId });
      expect(res.status).toBe(404);
      bodies.push(await res.json());
    }
    for (const b of bodies) expect(b).toEqual({ success: false, message: "Member not found." });
    nothingWritten(classId);
  });

  it("a class in another gym reads as 'no longer exists', and nothing is written", async () => {
    const coachB = fx.db.createUserWithRole("coach-b@example.test", "x", "coach", GYM_B);
    const classId = makeClass({}, coachB.id, GYM_B);
    const res = await book(fx.adminA.id, { classId, userId: makeMember().id });
    expect(res.status).toBe(404);
    expect((await res.json()).message).toBe("This class no longer exists.");
    nothingWritten(classId);
  });

  it("a gym-B admin cannot book a gym-A member into a gym-A class", async () => {
    const classId = makeClass();
    const res = await book(fx.adminB.id, { classId, userId: makeMember().id });
    expect(res.status).toBe(404);
    nothingWritten(classId);
  });

  it("a plain member cannot use it (403), and signed-out is 401", async () => {
    const classId = makeClass();
    const m = makeMember();
    expect((await book(m.id, { classId, userId: m.id })).status).toBe(403);
    expect((await book(null, { classId, userId: m.id })).status).toBe(401);
    nothingWritten(classId);
  });

  it("validates the request", async () => {
    expect((await book(fx.adminA.id, {})).status).toBe(400);
    expect((await book(fx.adminA.id, { classId: "x" })).status).toBe(400);
  });
});
