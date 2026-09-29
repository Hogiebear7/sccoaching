// Signup-time invite redemption, after the invite-bound-gym-assignment fix
// (lib/invites.ts's resolveInviteGymId, wired into both signup routes):
//   POST /api/auth/signup        (web)
//   POST /api/mobile/auth/signup (mobile)
//
// Both routes now resolve the inviter's gym BEFORE creating the account —
// createUserWithRole(email, passwordHash, "member", inviteGymId ?? null) —
// so the account is born in the inviter's own gym, never patched afterward.
// A client-supplied gymId in the request body is never read at all.
//
// This supersedes the account's OWN previous behavior (documented and
// pinned by this file before the fix): every invite-driven signup used to
// unconditionally land in the primary gym regardless of which gym's staff
// sent the invite, so a Gym B invite silently granted the PRIMARY gym's
// default package. That was the confirmed second-tenant blocker; the
// corrected assertions below are the fix, not new policy — the invite's
// resolved gym is the SAME data (invitedByStaffId -> inviter.gymId) that
// already existed and was already checked for existing-account redemption.
//
// What this pins, on the real chain
// signup route -> lib/invites (resolveInviteGymId + redeemInviteForUser) ->
// lib/tier-grant (only the datastore and provider-cancel call are mocked):
//   * a Gym A invite creates the account in Gym A (gymId: null, the primary-
//     gym convention) and grants Gym A's own default package;
//   * a Gym B invite creates the account in GYM B (gymId: "gym-b") and
//     grants GYM B's own default package — not the primary gym's;
//   * an invalid/expired/revoked/wrong-email/unresolvable-inviter invite
//     yields NO gym signal: the account is created exactly as it would be
//     with no token (gymId: null), matching the existing "an invite problem
//     never blocks signup" policy — this is the documented fail-closed
//     behavior for gym ASSIGNMENT specifically, not a rejection of signup;
//   * a client-supplied gymId / packageId in the signup body changes
//     nothing — it is never read;
//   * self-signup with no invite token is completely unchanged: no invite
//     lookup at all, primary-gym account, exactly as before this fix;
//   * account creation is a single createUserWithRole(...) call carrying
//     the already-resolved gym — there is no create-then-fix step, so no
//     wrong-gym partial account can ever exist, even transiently.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { verifySession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserByEmail: vi.fn(),
  createUserWithRole: vi.fn(),
  saveProfile: vi.fn(),
  saveCycleSettings: vi.fn(),
  saveCyclePrivacy: vi.fn(),
  findInviteByToken: vi.fn(),
  redeemInvite: vi.fn(),
  findUserById: vi.fn(),
  findMembershipCategories: vi.fn(),
  findMembershipPackages: vi.fn(),
  findMembershipPackageById: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  saveSubscription: vi.fn(),
  cancelProviderSubscription: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/billing", () => ({ cancelProviderSubscription: h.cancelProviderSubscription }));
vi.mock("@/lib/membership-entitlement", () => ({ resolveMemberTier: () => "membership" }));

type U = { id: string; email: string; role: string; gymId: string | null };
const user = (id: string, role: string, gymId: string | null): U => ({ id, email: `${id}@x.test`, role, gymId });

// Gym A = primary gym (gymId: null). Gym B = "gym-b".
const STAFF_A = user("staff-a", "admin", null);
const STAFF_B = user("staff-b", "admin", "gym-b");

const NEW_EMAIL = "new-athlete@example.com";

const CATEGORIES = [
  { id: "cat-a", gymId: null },
  { id: "cat-b", gymId: "gym-b" },
];
const pkg = (id: string, categoryId: string, sortOrder: number, deliveryChannel = "in_person") => ({
  id,
  categoryId,
  sortOrder,
  deliveryChannel,
  slug: id,
});
const PKG_B_FIRST = pkg("pkg-b-first", "cat-b", 0);
const PKG_A_DEFAULT = pkg("pkg-a-default", "cat-a", 1);
const PKG_A_SECOND = pkg("pkg-a-second", "cat-a", 2);
const PKG_B_SECOND = pkg("pkg-b-second", "cat-b", 3);
const PKG_APP = { ...pkg("pkg-app", "cat-b", -1, "app_only"), slug: "app-subscription-tier-2" };
const ALL_PACKAGES = [PKG_B_FIRST, PKG_A_DEFAULT, PKG_A_SECOND, PKG_B_SECOND, PKG_APP];

const invite = (invitedByStaffId: string, overrides: Record<string, unknown> = {}) => ({
  id: "inv-1",
  email: NEW_EMAIL,
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

const VALID_PAYLOAD = {
  email: NEW_EMAIL,
  password: "Str0ng!Pass",
  fullName: "New Athlete",
  phone: "555-0100",
  dateOfBirth: "1994-03-12",
  gender: "Female",
  primaryGoal: "General Health",
  currentWeightKg: "65",
  additionalInfo: "",
  emergencyContactName: "Jane Athlete",
  emergencyContactPhone: "555-0199",
  cycleTrackingEnabled: true,
};

type SignupResult = { status: number; body: Record<string, unknown>; sessionUserId: string | null };

async function callWeb(payload: unknown): Promise<SignupResult> {
  const { POST } = await import("@/app/api/auth/signup/route");
  const res = await POST(
    new Request("http://localhost/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
  const setCookie = res.headers.get("set-cookie") ?? "";
  const token = /session=([^;]+)/.exec(setCookie)?.[1];
  return { status: res.status, body: await res.json(), sessionUserId: token ? (verifySession(token)?.userId ?? null) : null };
}

async function callMobile(payload: unknown): Promise<SignupResult> {
  const { POST } = await import("@/app/api/mobile/auth/signup/route");
  const res = await POST(
    new Request("http://localhost/api/mobile/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
  const body = await res.json();
  const token = typeof body.token === "string" ? body.token : undefined;
  return { status: res.status, body, sessionUserId: token ? (verifySession(token)?.userId ?? null) : null };
}

const savedPackageIds = () => h.saveSubscription.mock.calls.map((c) => c[0].packageId);
// The gymId createUserWithRole was actually called with — the 4th argument.
const createdGymIds = () => h.createUserWithRole.mock.calls.map((c) => c[3]);

let createdUser: U | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  createdUser = undefined;
  h.findUserByEmail.mockReturnValue(undefined);
  // Mirrors the real createUserWithRole(email, passwordHash, role, gymId):
  // the created user's gymId is exactly whatever was passed in. Also
  // registers the created user for findUserById — grantMemberTier (called
  // during redemption, right after creation) looks the new member back up
  // by id, and that lookup must see the SAME gymId just assigned.
  h.createUserWithRole.mockImplementation((email: string, _passwordHash: string, role: string, gymId: string | null) => {
    createdUser = { id: "new-user", email, role, gymId };
    return { ...createdUser, createdAt: "now", updatedAt: "now" };
  });
  h.findUserById.mockImplementation((id: string) => [STAFF_A, STAFF_B, createdUser].find((u) => u?.id === id) ?? undefined);
  h.findMembershipCategories.mockImplementation(() => CATEGORIES);
  h.findMembershipPackages.mockImplementation(() => ALL_PACKAGES);
  h.findMembershipPackageById.mockImplementation((id: string) => ALL_PACKAGES.find((p) => p.id === id));
  h.findSubscriptionByUserId.mockReturnValue(undefined);
  h.findInviteByToken.mockReturnValue(invite(STAFF_A.id));
  h.redeemInvite.mockImplementation((id: string) => ({ ...invite(STAFF_A.id), id, status: "redeemed" }));
});

describe.each([
  ["web", callWeb],
  ["mobile", callMobile],
] as const)("%s signup — invite binds the new account to the INVITER's gym", (_name, signup) => {
  it("Gym A invite: account created in Gym A (primary/null), granted Gym A's own default package", async () => {
    const res = await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });

    expect(res.status).toBe(201);
    expect(res.sessionUserId).toBe("new-user");
    expect(createdGymIds()).toEqual([null]);
    expect(savedPackageIds()).toEqual(["pkg-a-default"]);
    expect(h.saveSubscription.mock.calls[0][0]).toMatchObject({ userId: "new-user", status: "active" });
    expect(h.redeemInvite).toHaveBeenCalledWith("inv-1", "new-user");
  });

  it("Gym B invite: account created in GYM B, granted GYM B's own default package — never the primary gym's (THE FIX)", async () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id));

    const res = await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });

    expect(res.status).toBe(201);
    expect(createdGymIds()).toEqual(["gym-b"]);
    expect(savedPackageIds()).toEqual(["pkg-b-first"]);
    expect(savedPackageIds()).not.toContain("pkg-a-default");
  });

  it("resolves the inviter's gym BEFORE account creation — one atomic call, never create-then-fix", async () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id));
    await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });

    expect(h.createUserWithRole).toHaveBeenCalledTimes(1);
    // The gym was already resolved and passed in on this single call —
    // no second write ever changes gymId afterward.
    expect(h.createUserWithRole).toHaveBeenCalledWith(NEW_EMAIL, expect.any(String), "member", "gym-b");
  });

  it("with no gym-b package the grant fails closed, but the account still correctly belongs to gym-b", async () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id));
    h.findMembershipPackages.mockReturnValue([PKG_A_DEFAULT, PKG_A_SECOND, PKG_APP]); // no gym-b package

    const res = await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });

    expect(res.status).toBe(201);
    // Gym assignment happens independently of, and before, the tier grant.
    expect(createdGymIds()).toEqual(["gym-b"]);
    // Fail closed: no subscription written, no other gym's package selected, invite left pending.
    expect(h.saveSubscription).not.toHaveBeenCalled();
    expect(h.findMembershipPackageById).not.toHaveBeenCalled();
    expect(h.redeemInvite).not.toHaveBeenCalled();
  });

  it("app_subscription invite still resolves the platform-wide app-only package, independent of the inviter's gym", async () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { tier: "app_subscription" }));

    await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });

    expect(createdGymIds()).toEqual(["gym-b"]);
    expect(savedPackageIds()).toEqual(["pkg-app"]);
  });

  it("ignores a client-supplied gymId / packageId in the signup body — the inviter's gym always wins", async () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id));

    const res = await signup({ ...VALID_PAYLOAD, inviteToken: "tok", gymId: "gym-a-attempt", packageId: "pkg-a-default" });

    expect(res.status).toBe(201);
    expect(createdGymIds()).toEqual(["gym-b"]); // inviter's gym, not the client-supplied one
    expect(savedPackageIds()).toEqual(["pkg-b-first"]);
    expect(h.findMembershipPackageById).not.toHaveBeenCalled();
    expect(h.saveProfile.mock.calls[0][0]).not.toHaveProperty("gymId");
  });

  it("an unknown, mismatched-email, already-redeemed, or revoked invite yields NO gym signal — account lands in the primary gym, same as no token at all", async () => {
    h.findInviteByToken.mockReturnValue(undefined);
    let res = await signup({ ...VALID_PAYLOAD, inviteToken: "bogus" });
    expect(res.status).toBe(201);

    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { email: "someone-else@example.com" }));
    res = await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });
    expect(res.status).toBe(201);

    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { status: "redeemed" }));
    res = await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });
    expect(res.status).toBe(201);

    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { status: "revoked" }));
    res = await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });
    expect(res.status).toBe(201);

    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { status: "expired" }));
    res = await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });
    expect(res.status).toBe(201);

    // Every one of the 5 calls above created a primary-gym (null) account —
    // never gym-b, and never a guess.
    expect(createdGymIds()).toEqual([null, null, null, null, null]);
    expect(h.saveSubscription).not.toHaveBeenCalled();
    expect(h.redeemInvite).not.toHaveBeenCalled();
  });

  it("an inviter whose account no longer resolves fails closed on gym assignment — primary gym, never a guess", async () => {
    h.findInviteByToken.mockReturnValue(invite("deleted-staff-id"));
    // findUserById already returns undefined for any id it doesn't recognize.

    const res = await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });

    expect(res.status).toBe(201);
    expect(createdGymIds()).toEqual([null]);
  });

  it("does not look up any invite, inviter, or package when there is no invite token (self-signup, unchanged)", async () => {
    const res = await signup(VALID_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.sessionUserId).toBe("new-user");
    expect(createdGymIds()).toEqual([null]);
    expect(h.findInviteByToken).not.toHaveBeenCalled();
    expect(h.findMembershipPackages).not.toHaveBeenCalled();
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("keeps validation and duplicate-email behavior unchanged, creating nothing", async () => {
    const missing = await signup({ ...VALID_PAYLOAD, email: "", inviteToken: "tok" });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toBe("Email and password are required.");

    const weak = await signup({ ...VALID_PAYLOAD, password: "weak", inviteToken: "tok" });
    expect(weak.status).toBe(400);

    h.findUserByEmail.mockReturnValue({ id: "existing" });
    const duplicate = await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.message).toBe("Unable to create account.");

    expect(h.createUserWithRole).not.toHaveBeenCalled();
    expect(h.findInviteByToken).not.toHaveBeenCalled();
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });
});
