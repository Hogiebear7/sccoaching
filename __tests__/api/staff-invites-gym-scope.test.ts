// Route-level cross-gym authorization tests for app/api/staff/invites/*.
// invites/[inviteId]/revoke previously had a capability check but no
// ownership check at all — it revoked by id with no lookup. invites/route.ts
// GET returned every gym's invites unfiltered. Both derive ownership via
// InviteRecord.invitedByStaffId -> sameGymAsStaff(), the same one-hop
// pattern used for classes/programs. See
// docs/tenant-boundary-audit-2026-09.md and the follow-up plan that closed
// this gap.
//
// Conventions reused verbatim from the other gym-scope test files: real
// signSession() + a session cookie, sameGymAsStaff()/can() left un-mocked.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findInviteById: vi.fn(),
  revokeInvite: vi.fn(),
  findInvites: vi.fn(),
  createInvite: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

// invites/route.ts also imports these at module scope for POST — mocked as
// no-ops so importing the module for GET-only tests never sends a real
// email; POST/create isn't part of this slice (invite creation is already
// self-scoped via invitedByStaffId: staffUser.id, no gap to close there).
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email-templates", () => ({ inviteEmail: vi.fn(() => ({ subject: "", html: "", text: "" })) }));

// gymId: null is the established primary-gym convention.
const GYM_A_STAFF = { id: "staff-a", email: "staffa@x.test", role: "admin_manager" as const, gymId: null, archivedAt: null };
const GYM_A_INVITER = { id: "inviter-a", email: "invitera@x.test", role: "admin_manager" as const, gymId: null, archivedAt: null };
const GYM_B_INVITER = { id: "inviter-b", email: "inviterb@x.test", role: "admin_manager" as const, gymId: "gym-b", archivedAt: null };
const MEMBER_USER = { id: "member-1", email: "member@x.test", role: "member" as const, gymId: null, archivedAt: null };

function usersById(...users: { id: string }[]) {
  const map = new Map(users.map((u) => [u.id, u]));
  return (id: string) => map.get(id);
}

async function post(path: string, { body, params, sessionUserId = GYM_A_STAFF.id }: { body?: unknown; params?: Record<string, string>; sessionUserId?: string } = {}) {
  const mod = await import(`@/app/api/staff/invites${path}/route`);
  const token = signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS);
  const req = new NextRequest(`http://localhost/api/staff/invites${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `session=${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return params ? mod.POST(req, { params: Promise.resolve(params) }) : mod.POST(req);
}

async function get(sessionUserId = GYM_A_STAFF.id) {
  const mod = await import("@/app/api/staff/invites/route");
  const token = signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS);
  const req = new NextRequest("http://localhost/api/staff/invites", {
    headers: { Cookie: `session=${token}` },
  });
  return mod.GET(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation(usersById(GYM_A_STAFF, GYM_A_INVITER, GYM_B_INVITER, MEMBER_USER));
});

describe("POST /api/staff/invites/[inviteId]/revoke", () => {
  it("denies revoking a cross-gym invite", async () => {
    h.findInviteById.mockReturnValue({ id: "invite-1", invitedByStaffId: GYM_B_INVITER.id, status: "pending" });
    const res = await post("/[inviteId]/revoke", { params: { inviteId: "invite-1" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      message: "This invite can't be revoked (already used, expired, or not found).",
    });
    expect(h.revokeInvite).not.toHaveBeenCalled();
  });

  it("revokes a same-gym invite (control)", async () => {
    h.findInviteById.mockReturnValue({ id: "invite-1", invitedByStaffId: GYM_A_INVITER.id, status: "pending" });
    h.revokeInvite.mockReturnValue(true);
    const res = await post("/[inviteId]/revoke", { params: { inviteId: "invite-1" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, message: "Invite revoked." });
    expect(h.revokeInvite).toHaveBeenCalledWith("invite-1");
  });

  it("denies an unauthenticated request", async () => {
    const mod = await import("@/app/api/staff/invites/[inviteId]/revoke/route");
    const req = new NextRequest("http://localhost/api/staff/invites/invite-1/revoke", { method: "POST" });
    const res = await mod.POST(req, { params: Promise.resolve({ inviteId: "invite-1" }) });
    expect(res.status).toBe(403);
  });

  it("denies a member without members.billing", async () => {
    const res = await post("/[inviteId]/revoke", { params: { inviteId: "invite-1" }, sessionUserId: MEMBER_USER.id });
    expect(res.status).toBe(403);
    expect(h.revokeInvite).not.toHaveBeenCalled();
  });

  it("returns the same generic message for a missing invite", async () => {
    h.findInviteById.mockReturnValue(undefined);
    const res = await post("/[inviteId]/revoke", { params: { inviteId: "does-not-exist" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      message: "This invite can't be revoked (already used, expired, or not found).",
    });
  });

  it("returns the same generic message for an already-revoked same-gym invite", async () => {
    // revokeInvite() itself refuses non-pending invites — the ownership
    // check passes (same gym), but the underlying revoke still no-ops.
    h.findInviteById.mockReturnValue({ id: "invite-1", invitedByStaffId: GYM_A_INVITER.id, status: "revoked" });
    h.revokeInvite.mockReturnValue(false);
    const res = await post("/[inviteId]/revoke", { params: { inviteId: "invite-1" } });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/staff/invites", () => {
  it("returns only same-gym invites, excluding other gyms'", async () => {
    h.findInvites.mockReturnValue([
      { id: "invite-a", invitedByStaffId: GYM_A_INVITER.id, email: "a@x.test", tier: "membership" },
      { id: "invite-b", invitedByStaffId: GYM_B_INVITER.id, email: "b@x.test", tier: "membership" },
    ]);
    const res = await get();
    expect(res.status).toBe(200);
    const data = await res.json();
    const ids = data.data.map((i: { id: string }) => i.id);
    expect(ids).toContain("invite-a");
    expect(ids).not.toContain("invite-b");
    // Preserves response shape — still { success, data: [...] } with the
    // invite objects untouched, just filtered.
    expect(data.data[0]).toMatchObject({ email: "a@x.test", tier: "membership" });
  });

  it("denies an unauthenticated request", async () => {
    const mod = await import("@/app/api/staff/invites/route");
    const req = new NextRequest("http://localhost/api/staff/invites");
    const res = await mod.GET(req);
    expect(res.status).toBe(403);
  });

  it("denies a member without members.billing", async () => {
    const res = await get(MEMBER_USER.id);
    expect(res.status).toBe(403);
  });
});
