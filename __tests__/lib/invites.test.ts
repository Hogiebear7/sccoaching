// lib/invites.ts's resolveInviteGymId — decides which gym a brand-new
// account should be created in when signup carries an invite token.
// Read-only (never consumes the invite). Callers only ever call this with a
// non-empty token (the "no token supplied" case is the caller's own
// { kind: "none" } branch); this function returns exactly one of:
//   { kind: "valid", gymId }  — the invite is genuinely pending, addressed
//                               to this email, and its inviter resolves.
//   { kind: "invalid" }       — every other case: missing/redeemed/revoked/
//                               expired invite, wrong email, or an
//                               unresolvable inviter. Callers MUST reject
//                               signup outright for "invalid" — never fall
//                               back to creating a primary-gym account.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findInviteByToken: vi.fn(),
  findUserById: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

import { resolveInviteGymId } from "@/lib/invites";

const STAFF_A = { id: "staff-a", gymId: null };
const STAFF_B = { id: "staff-b", gymId: "gym-b" };
const EMAIL = "athlete@example.com";

const invite = (invitedByStaffId: string, overrides: Record<string, unknown> = {}) => ({
  id: "inv-1",
  email: EMAIL,
  tier: "membership" as const,
  tokenHash: "h",
  status: "pending" as const,
  invitedByStaffId,
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
  redeemedAt: null,
  redeemedByUserId: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => [STAFF_A, STAFF_B].find((u) => u.id === id));
});

describe("resolveInviteGymId", () => {
  it("resolves the inviter's own gym for a genuinely pending, matching-email invite", () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id));
    expect(resolveInviteGymId("tok", EMAIL)).toEqual({ kind: "valid", gymId: "gym-b" });
  });

  it("resolves gymId: null (primary gym) when the inviter is themselves primary-gym", () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_A.id));
    expect(resolveInviteGymId("tok", EMAIL)).toEqual({ kind: "valid", gymId: null });
  });

  it("matches email case-insensitively, same as redeemInviteForUser", () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id));
    expect(resolveInviteGymId("tok", EMAIL.toUpperCase())).toEqual({ kind: "valid", gymId: "gym-b" });
  });

  it("is invalid for a missing/unknown token", () => {
    h.findInviteByToken.mockReturnValue(undefined);
    expect(resolveInviteGymId("bogus", EMAIL)).toEqual({ kind: "invalid" });
  });

  it("is invalid for an already-redeemed invite", () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { status: "redeemed" }));
    expect(resolveInviteGymId("tok", EMAIL)).toEqual({ kind: "invalid" });
  });

  it("is invalid for a revoked invite", () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { status: "revoked" }));
    expect(resolveInviteGymId("tok", EMAIL)).toEqual({ kind: "invalid" });
  });

  it("is invalid for an expired invite", () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { status: "expired" }));
    expect(resolveInviteGymId("tok", EMAIL)).toEqual({ kind: "invalid" });
  });

  it("is invalid for a mismatched email — never leaks which gym the token belongs to", () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { email: "someone-else@example.com" }));
    expect(resolveInviteGymId("tok", EMAIL)).toEqual({ kind: "invalid" });
  });

  it("is invalid, never a guess, when the inviter's own account no longer resolves", () => {
    h.findInviteByToken.mockReturnValue(invite("deleted-staff-id"));
    expect(resolveInviteGymId("tok", EMAIL)).toEqual({ kind: "invalid" });
  });

  it("never consumes the invite — read-only", () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id));
    resolveInviteGymId("tok", EMAIL);
    // No redeemInvite import/call exists in this module's resolveInviteGymId
    // path at all — nothing to assert a call count on, which is the point:
    // only findInviteByToken and findUserById are touched.
    expect(h.findInviteByToken).toHaveBeenCalledWith("tok");
    expect(h.findUserById).toHaveBeenCalledWith(STAFF_B.id);
  });
});
