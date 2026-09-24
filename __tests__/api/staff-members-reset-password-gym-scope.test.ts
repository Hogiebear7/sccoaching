// Same-gym authorization for app/api/staff/members/reset-password/route.ts.
// The route mints a working reset token and RETURNS the reset URL, so a
// missing gym check would be cross-gym account takeover. The target must be
// in the acting staff member's gym; a cross-gym target is folded into the
// existing "Member not found." 404, before any token is created, saved,
// logged, or returned. Auth uses the real signed-session mechanism; sameGym
// and can() are deliberately not mocked.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  createResetToken: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

// gymId: null is the established primary-gym convention (lib/gym-scope.ts).
const GYM_A_ADMIN = { id: "admin-a", email: "admina@x.test", role: "admin" as const, gymId: null, archivedAt: null };
const GYM_B_ADMIN = { id: "admin-b", email: "adminb@x.test", role: "admin" as const, gymId: "gym-b", archivedAt: null };
const GYM_A_COACH = { id: "coach-a", email: "coacha@x.test", role: "coach" as const, gymId: null, archivedAt: null };
const GYM_B_COACH = { id: "coach-b", email: "coachb@x.test", role: "coach" as const, gymId: "gym-b", archivedAt: null };
const GYM_A_MEMBER = { id: "member-a", email: "membera@x.test", role: "member" as const, gymId: null, archivedAt: null };
const GYM_B_MEMBER = { id: "member-b", email: "memberb@x.test", role: "member" as const, gymId: "gym-b", archivedAt: null };

const NOT_FOUND = { success: false, message: "Member not found." };

async function post(body: unknown, sessionUserId?: string, rawBody?: string) {
  const mod = await import("@/app/api/staff/members/reset-password/route");
  const req = new NextRequest("http://localhost/api/staff/members/reset-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionUserId
        ? { Cookie: `session=${signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS)}` }
        : {}),
    },
    body: rawBody ?? JSON.stringify(body),
  });
  return mod.POST(req);
}

const reset = (userId: string, sessionUserId: string = GYM_A_ADMIN.id) => post({ userId }, sessionUserId);

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  h.findUserById.mockImplementation((id: string) =>
    [GYM_A_ADMIN, GYM_B_ADMIN, GYM_A_COACH, GYM_B_COACH, GYM_A_MEMBER, GYM_B_MEMBER].find((u) => u.id === id)
  );
  h.createResetToken.mockReturnValue({ token: "tok-123", expiresAt: "2030-01-01T00:00:00.000Z" });
});

afterEach(() => {
  logSpy.mockRestore();
});

function expectNothingIssued() {
  expect(h.createResetToken).not.toHaveBeenCalled();
  expect(logSpy).not.toHaveBeenCalled();
}

describe("POST /api/staff/members/reset-password — same-gym authorization", () => {
  it("creates a reset link for a same-gym member, with the existing response shape and URL format", async () => {
    const res = await reset(GYM_A_MEMBER.id);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({
      success: true,
      message: "Reset link created.",
      resetUrl: "http://localhost/reset-password?token=tok-123",
    });
    expect(h.createResetToken).toHaveBeenCalledTimes(1);
    expect(h.createResetToken).toHaveBeenCalledWith(GYM_A_MEMBER.id);
  });

  it("works within the second gym too (gym-B admin, gym-B member)", async () => {
    const res = await reset(GYM_B_MEMBER.id, GYM_B_ADMIN.id);

    expect(res.status).toBe(200);
    expect(h.createResetToken).toHaveBeenCalledWith(GYM_B_MEMBER.id);
  });

  it("denies a cross-gym target with the existing 404, and issues no token, log line, or reset URL", async () => {
    const res = await reset(GYM_B_MEMBER.id, GYM_A_ADMIN.id);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data).toEqual(NOT_FOUND);
    expect("resetUrl" in data).toBe(false);
    expectNothingIssued();
  });

  it("denies the reverse direction too (gym-B admin, gym-A member)", async () => {
    const res = await reset(GYM_A_MEMBER.id, GYM_B_ADMIN.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expectNothingIssued();
  });

  it("returns the identical 404 for a missing target as for a cross-gym target", async () => {
    const crossGym = await reset(GYM_B_MEMBER.id);
    const crossGymBody = await crossGym.json();
    const missing = await reset("member-missing");
    const missingBody = await missing.json();

    expect(crossGym.status).toBe(404);
    expect(missing.status).toBe(crossGym.status);
    expect(missingBody).toEqual(crossGymBody);
    expectNothingIssued();
  });

  it("does not reveal the target's role: a cross-gym staff account gets the same 404 as a cross-gym member", async () => {
    const crossGymMember = await (await reset(GYM_B_MEMBER.id)).json();
    const crossGymCoach = await reset(GYM_B_COACH.id);
    const crossGymAdmin = await reset(GYM_B_ADMIN.id);

    expect(crossGymCoach.status).toBe(404);
    expect(await crossGymCoach.json()).toEqual(crossGymMember);
    expect(crossGymAdmin.status).toBe(404);
    expect(await crossGymAdmin.json()).toEqual(crossGymMember);
    expectNothingIssued();
  });

  it("ignores a client-supplied gymId: authorization comes from the server-side user records", async () => {
    const res = await post({ userId: GYM_B_MEMBER.id, gymId: null }, GYM_A_ADMIN.id);

    expect(res.status).toBe(404);
    expectNothingIssued();
  });

  it("preserves the existing capability check (coach lacks members.account), even for a same-gym target", async () => {
    const res = await reset(GYM_A_MEMBER.id, GYM_A_COACH.id);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, message: "Only staff can manage members." });
    expectNothingIssued();
  });

  it("checks the capability before the gym: an unauthorized cross-gym request is 403, not 404", async () => {
    const res = await reset(GYM_B_MEMBER.id, GYM_A_COACH.id);

    expect(res.status).toBe(403);
    expectNothingIssued();
  });

  it("preserves the existing unauthenticated response", async () => {
    const res = await post({ userId: GYM_A_MEMBER.id });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, message: "You must be signed in to manage members." });
    expectNothingIssued();
  });

  it("preserves the existing request validation without issuing anything", async () => {
    const badJson = await post(undefined, GYM_A_ADMIN.id, "{not json");
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).message).toBe("Invalid JSON body.");

    const noUser = await post({}, GYM_A_ADMIN.id);
    expect(noUser.status).toBe(400);
    expect((await noUser.json()).message).toBe("A member is required.");

    expectNothingIssued();
  });
});
