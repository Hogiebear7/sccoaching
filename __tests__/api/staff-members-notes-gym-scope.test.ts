// Same-gym authorization for app/api/staff/members/notes/route.ts. The target
// must be in the acting staff member's gym; a cross-gym target is folded into
// the existing "Member not found." 404, before saveCoachNote. Auth uses the
// real signed-session mechanism; sameGym and can() are deliberately not mocked.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  saveCoachNote: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

// gymId: null is the established primary-gym convention (lib/gym-scope.ts).
// "coach" is the lowest role with members.edit.
const GYM_A_COACH = { id: "coach-a", email: "coacha@x.test", role: "coach" as const, gymId: null, archivedAt: null };
const GYM_B_COACH = { id: "coach-b", email: "coachb@x.test", role: "coach" as const, gymId: "gym-b", archivedAt: null };
const GYM_A_MEMBER = { id: "member-a", email: "membera@x.test", role: "member" as const, gymId: null, archivedAt: null };
const GYM_B_MEMBER = { id: "member-b", email: "memberb@x.test", role: "member" as const, gymId: "gym-b", archivedAt: null };
const GYM_A_ADMIN = { id: "admin-a", email: "admina@x.test", role: "admin" as const, gymId: null, archivedAt: null };
const GYM_B_ADMIN = { id: "admin-b", email: "adminb@x.test", role: "admin" as const, gymId: "gym-b", archivedAt: null };

const NOT_FOUND = { success: false, message: "Member not found." };

async function post(body: unknown, sessionUserId?: string, rawBody?: string) {
  const mod = await import("@/app/api/staff/members/notes/route");
  const req = new NextRequest("http://localhost/api/staff/members/notes", {
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

const writeNote = (userId: string, notes: unknown = "Knee is sore", sessionUserId: string = GYM_A_COACH.id) =>
  post({ userId, notes }, sessionUserId);

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) =>
    [GYM_A_COACH, GYM_B_COACH, GYM_A_MEMBER, GYM_B_MEMBER, GYM_A_ADMIN, GYM_B_ADMIN].find((u) => u.id === id)
  );
});

describe("POST /api/staff/members/notes — same-gym authorization", () => {
  it("saves a note for a same-gym member with the existing response and persistence", async () => {
    const res = await writeNote(GYM_A_MEMBER.id, "  Knee is sore  ");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Notes saved." });
    expect(h.saveCoachNote).toHaveBeenCalledTimes(1);
    expect(h.saveCoachNote).toHaveBeenCalledWith(
      expect.objectContaining({ userId: GYM_A_MEMBER.id, notes: "Knee is sore", updatedByStaffId: GYM_A_COACH.id })
    );
  });

  it("works within the second gym too (gym-B coach, gym-B member)", async () => {
    const res = await writeNote(GYM_B_MEMBER.id, "Second gym note", GYM_B_COACH.id);

    expect(res.status).toBe(200);
    expect(h.saveCoachNote).toHaveBeenCalledWith(
      expect.objectContaining({ userId: GYM_B_MEMBER.id, updatedByStaffId: GYM_B_COACH.id })
    );
  });

  it("denies a cross-gym target with the existing 404 and never calls saveCoachNote", async () => {
    const res = await writeNote(GYM_B_MEMBER.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expect(h.saveCoachNote).not.toHaveBeenCalled();
  });

  it("denies the reverse direction too (gym-B coach, gym-A member)", async () => {
    const res = await writeNote(GYM_A_MEMBER.id, "x", GYM_B_COACH.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expect(h.saveCoachNote).not.toHaveBeenCalled();
  });

  it("returns the identical 404 for a missing target as for a cross-gym target", async () => {
    const crossGym = await writeNote(GYM_B_MEMBER.id);
    const crossGymBody = await crossGym.json();
    const missing = await writeNote("member-missing");
    const missingBody = await missing.json();

    expect(crossGym.status).toBe(404);
    expect(missing.status).toBe(crossGym.status);
    expect(missingBody).toEqual(crossGymBody);
    expect(h.saveCoachNote).not.toHaveBeenCalled();
  });

  it("does not reveal the target's role: a cross-gym staff account gets the same 404 as a cross-gym member", async () => {
    const crossGymMember = await (await writeNote(GYM_B_MEMBER.id)).json();
    const crossGymCoach = await writeNote(GYM_B_COACH.id);
    const crossGymAdmin = await writeNote(GYM_B_ADMIN.id);

    expect(crossGymCoach.status).toBe(404);
    expect(await crossGymCoach.json()).toEqual(crossGymMember);
    expect(crossGymAdmin.status).toBe(404);
    expect(await crossGymAdmin.json()).toEqual(crossGymMember);
    expect(h.saveCoachNote).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied gymId: authorization comes from the server-side user records", async () => {
    const res = await post({ userId: GYM_B_MEMBER.id, notes: "x", gymId: null }, GYM_A_COACH.id);

    expect(res.status).toBe(404);
    expect(h.saveCoachNote).not.toHaveBeenCalled();
  });

  it("preserves the existing note handling: a non-string note is saved as an empty string", async () => {
    const res = await writeNote(GYM_A_MEMBER.id, 42);

    expect(res.status).toBe(200);
    expect(h.saveCoachNote).toHaveBeenCalledWith(expect.objectContaining({ userId: GYM_A_MEMBER.id, notes: "" }));
  });

  it("preserves the existing capability check (a plain member lacks members.edit), even for a same-gym target", async () => {
    const res = await writeNote(GYM_A_MEMBER.id, "x", GYM_A_MEMBER.id);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, message: "Only staff can manage members." });
    expect(h.saveCoachNote).not.toHaveBeenCalled();
  });

  it("checks the capability before the gym: an unauthorized cross-gym request is 403, not 404", async () => {
    const res = await writeNote(GYM_B_MEMBER.id, "x", GYM_A_MEMBER.id);

    expect(res.status).toBe(403);
    expect(h.saveCoachNote).not.toHaveBeenCalled();
  });

  it("preserves the existing unauthenticated response", async () => {
    const res = await post({ userId: GYM_A_MEMBER.id, notes: "x" });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, message: "You must be signed in to manage members." });
    expect(h.saveCoachNote).not.toHaveBeenCalled();
  });

  it("preserves the existing request validation without saving", async () => {
    const badJson = await post(undefined, GYM_A_COACH.id, "{not json");
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).message).toBe("Invalid JSON body.");

    const noUser = await post({ notes: "x" }, GYM_A_COACH.id);
    expect(noUser.status).toBe(400);
    expect((await noUser.json()).message).toBe("A member is required.");

    expect(h.saveCoachNote).not.toHaveBeenCalled();
  });
});
