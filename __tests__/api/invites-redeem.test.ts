// POST /api/invites/redeem — for a member who ALREADY has an account. Their
// gym is established at signup, so an invite from a DIFFERENT gym's staff
// can never be redeemed against it: sameGymAsStaff(user, invite.invitedByStaffId)
// is checked before any redemption is attempted, and a cross-gym invite
// reads EXACTLY like a missing/invalid one — same message, same status, no
// existence leak. (New-account invite redemption instead binds the account
// to the inviter's own gym at creation time — see
// __tests__/api/signup-invite-gym-scope.test.ts and lib/invites.ts's
// resolveInviteGymId — this route never needs to reassign a gym.)
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findInviteByToken: vi.fn(),
  findUserById: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const { mockVerifyRequestSession } = vi.hoisted(() => ({ mockVerifyRequestSession: vi.fn() }));
vi.mock("@/lib/mobile-auth", () => ({ verifyRequestSession: mockVerifyRequestSession }));

const { mockRedeemInviteForUser } = vi.hoisted(() => ({ mockRedeemInviteForUser: vi.fn() }));
vi.mock("@/lib/invites", () => ({ redeemInviteForUser: mockRedeemInviteForUser }));

type FixtureUser = { id: string; email: string; role: string; gymId: string | null };
const GYM_A_MEMBER: FixtureUser = { id: "member-a", email: "a@x.test", role: "member", gymId: null };
const GYM_B_MEMBER: FixtureUser = { id: "member-b", email: "b@x.test", role: "member", gymId: "gym-b" };
const STAFF_A: { id: string; gymId: string | null } = { id: "staff-a", gymId: null };
const STAFF_B: { id: string; gymId: string | null } = { id: "staff-b", gymId: "gym-b" };

const invite = (invitedByStaffId: string, overrides: Record<string, unknown> = {}) => ({
  id: "inv-1",
  email: "someone@example.com",
  tier: "membership" as const,
  invitedByStaffId,
  status: "pending" as const,
  ...overrides,
});

async function call(token: unknown, asUser: typeof GYM_A_MEMBER | null) {
  mockVerifyRequestSession.mockReturnValue(asUser ? { userId: asUser.id } : null);
  h.findUserById.mockImplementation((id: string) =>
    [GYM_A_MEMBER, GYM_B_MEMBER, STAFF_A, STAFF_B].find((u) => u.id === id)
  );
  const { POST } = await import("@/app/api/invites/redeem/route");
  const req = new Request("http://localhost/api/invites/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const res = await POST(req as never);
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Mirrors redeemInviteForUser's own real behavior closely enough for this
  // route's tests: a recognized token succeeds, anything else fails with
  // the exact same generic message the real function returns for a missing
  // token — this route's own pre-check is what's under test here, not
  // redeemInviteForUser's internals (covered separately).
  mockRedeemInviteForUser.mockImplementation(async (token: string) =>
    token === "tok"
      ? { ok: true, message: "Invite redeemed — welcome!", invite: invite(STAFF_A.id) }
      : { ok: false, message: "This invite link isn't valid." }
  );
});

describe("POST /api/invites/redeem — existing-account gym scope", () => {
  it("Gym B member + Gym B invite: succeeds", async () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id));

    const res = await call("tok", GYM_B_MEMBER);

    expect(res.status).toBe(200);
    expect(mockRedeemInviteForUser).toHaveBeenCalledWith("tok", GYM_B_MEMBER);
  });

  it("Gym A member + Gym B invite: rejected, never delegated to redemption", async () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id));

    const res = await call("tok", GYM_A_MEMBER);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("This invite link isn't valid.");
    expect(mockRedeemInviteForUser).not.toHaveBeenCalled();
  });

  it("gives a cross-gym invite the SAME response as a genuinely missing one — no existence leak", async () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id));
    const crossGym = await call("tok", GYM_A_MEMBER);

    h.findInviteByToken.mockReturnValue(undefined);
    const missing = await call("does-not-exist", GYM_A_MEMBER);

    expect(crossGym.status).toBe(missing.status);
    expect(crossGym.body).toEqual(missing.body);
  });

  it("an inviter whose account no longer resolves fails closed — rejected, not delegated", async () => {
    h.findInviteByToken.mockReturnValue(invite("deleted-staff-id"));

    const res = await call("tok", GYM_A_MEMBER);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("This invite link isn't valid.");
    expect(mockRedeemInviteForUser).not.toHaveBeenCalled();
  });

  it("same-gym redemption (control): Gym A member + Gym A invite succeeds", async () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_A.id));

    const res = await call("tok", GYM_A_MEMBER);

    expect(res.status).toBe(200);
    expect(mockRedeemInviteForUser).toHaveBeenCalledWith("tok", GYM_A_MEMBER);
  });

  it("rejects an unauthenticated request before any invite lookup", async () => {
    const res = await call("tok", null);

    expect(res.status).toBe(401);
    expect(h.findInviteByToken).not.toHaveBeenCalled();
    expect(mockRedeemInviteForUser).not.toHaveBeenCalled();
  });

  it("requires a token", async () => {
    const res = await call("", GYM_A_MEMBER);

    expect(res.status).toBe(400);
    expect(mockRedeemInviteForUser).not.toHaveBeenCalled();
  });
});
