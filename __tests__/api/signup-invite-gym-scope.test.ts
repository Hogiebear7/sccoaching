// Signup-time invite redemption, after the gym-scoped grantMemberTier change
// (lib/tier-grant.ts). Both signup routes —
//   POST /api/auth/signup        (web)
//   POST /api/mobile/auth/signup (mobile)
// — create the account with createUser(email, passwordHash), which stores
// gymId: null (the primary-gym convention, lib/gym-scope.ts), then call
// redeemInviteForUser(token, user) -> grantMemberTier(user.id, invite.tier) and
// IGNORE the result: a token that can't be redeemed just leaves a Free account.
//
// What this pins, on the real chain signup route -> lib/invites -> lib/tier-grant
// (only the datastore and the provider-cancel call are mocked):
//   * a membership invite grants a package owned by the NEW MEMBER's gym — the
//     primary gym, since signup assigns no gym — never another gym's package,
//     even when another gym's package sorts first platform-wide (the old pick);
//   * with no primary-gym package the grant fails closed (nothing saved, no other
//     gym's package looked up, invite left unconsumed) and the account is still
//     created as Free (the existing "honor-system" behavior);
//   * a client-supplied gymId / packageId in the signup body changes nothing;
//   * invalid-invite, validation, duplicate-email and account-creation behavior
//     are unchanged.
// Assigning a gym at signup is an UNRESOLVED PRODUCT DECISION: nothing here
// invents a policy — it documents that signup accounts are primary-gym (null)
// accounts, so a gym B invite redeemed at signup attaches the primary gym's
// package rather than gym B's.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { verifySession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserByEmail: vi.fn(),
  createUser: vi.fn(),
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
// Mirrors the real createUser(): role "member", gymId null — signup assigns no gym.
const NEW_USER = { id: "new-user", email: NEW_EMAIL, role: "member", gymId: null, createdAt: "now", updatedAt: "now" };

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
// Gym B's package sorts FIRST platform-wide: the old default pick would have chosen it.
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

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserByEmail.mockReturnValue(undefined);
  h.createUser.mockReturnValue(NEW_USER);
  h.findUserById.mockImplementation((id: string) => [STAFF_A, STAFF_B, NEW_USER].find((u) => u.id === id));
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
] as const)("%s signup — invite redemption is primary-gym scoped", (_name, signup) => {
  it("grants the primary gym's default package for a primary-gym invite and consumes the invite", async () => {
    const res = await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });

    expect(res.status).toBe(201);
    expect(res.sessionUserId).toBe("new-user");
    expect(savedPackageIds()).toEqual(["pkg-a-default"]);
    expect(h.saveSubscription.mock.calls[0][0]).toMatchObject({ userId: "new-user", status: "active" });
    expect(h.redeemInvite).toHaveBeenCalledWith("inv-1", "new-user");
  });

  it("never grants another gym's package — even a gym B invite gets the primary gym's package, not gym B's first-sorted one", async () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id));

    const res = await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });

    expect(res.status).toBe(201);
    expect(savedPackageIds()).toEqual(["pkg-a-default"]);
    expect(savedPackageIds()).not.toContain("pkg-b-first");
    expect(savedPackageIds().some((id) => id.startsWith("pkg-b"))).toBe(false);
    // The default path never looks a package up by id, so no other gym's package is even fetched.
    expect(h.findMembershipPackageById).not.toHaveBeenCalled();
  });

  it("with no primary-gym package the grant fails closed, and signup still creates a Free account", async () => {
    h.findMembershipPackages.mockReturnValue([PKG_B_FIRST, PKG_B_SECOND, PKG_APP]); // no primary-gym package

    const res = await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });

    // Existing behavior: a failed invite grant never blocks account creation.
    expect(res.status).toBe(201);
    expect(res.sessionUserId).toBe("new-user");
    expect(h.createUser).toHaveBeenCalledTimes(1);
    expect(h.saveProfile).toHaveBeenCalledTimes(1);
    // Fail closed: no subscription written, no other gym's package selected or fetched, invite left pending.
    expect(h.saveSubscription).not.toHaveBeenCalled();
    expect(h.findMembershipPackageById).not.toHaveBeenCalled();
    expect(h.redeemInvite).not.toHaveBeenCalled();
  });

  it("stays compatible for a single-gym (all primary) catalog: lowest-sortOrder package, and the app-subscription invite is unchanged", async () => {
    h.findMembershipPackages.mockReturnValue([PKG_A_SECOND, PKG_A_DEFAULT]);

    await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });
    expect(savedPackageIds()).toEqual(["pkg-a-default"]);

    // app_subscription resolves the platform-wide app-only package by slug, independent of gym.
    vi.clearAllMocks();
    h.findUserByEmail.mockReturnValue(undefined);
    h.createUser.mockReturnValue(NEW_USER);
    h.findUserById.mockImplementation((id: string) => [STAFF_A, STAFF_B, NEW_USER].find((u) => u.id === id));
    h.findMembershipPackages.mockReturnValue(ALL_PACKAGES);
    h.findSubscriptionByUserId.mockReturnValue(undefined);
    h.findInviteByToken.mockReturnValue(invite(STAFF_A.id, { tier: "app_subscription" }));
    h.redeemInvite.mockReturnValue({ ...invite(STAFF_A.id), status: "redeemed" });

    await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });
    expect(savedPackageIds()).toEqual(["pkg-app"]);
  });

  it("ignores a client-supplied gymId / packageId in the signup body", async () => {
    const res = await signup({ ...VALID_PAYLOAD, inviteToken: "tok", gymId: "gym-b", packageId: "pkg-b-first" });

    expect(res.status).toBe(201);
    expect(savedPackageIds()).toEqual(["pkg-a-default"]);
    expect(h.findMembershipPackageById).not.toHaveBeenCalled();
    // The account is created by the same two-argument call, and no gym reaches the profile.
    expect(h.createUser).toHaveBeenCalledTimes(1);
    expect(h.createUser.mock.calls[0]).toHaveLength(2);
    expect(h.saveProfile.mock.calls[0][0]).not.toHaveProperty("gymId");
  });

  it("leaves invalid-invite handling unchanged: unknown, mismatched-email and used invites just leave a Free account", async () => {
    h.findInviteByToken.mockReturnValue(undefined);
    expect((await signup({ ...VALID_PAYLOAD, inviteToken: "bogus" })).status).toBe(201);

    h.findInviteByToken.mockReturnValue(invite(STAFF_A.id, { email: "someone-else@example.com" }));
    expect((await signup({ ...VALID_PAYLOAD, inviteToken: "tok" })).status).toBe(201);

    h.findInviteByToken.mockReturnValue(invite(STAFF_A.id, { status: "redeemed" }));
    expect((await signup({ ...VALID_PAYLOAD, inviteToken: "tok" })).status).toBe(201);

    expect(h.saveSubscription).not.toHaveBeenCalled();
    expect(h.redeemInvite).not.toHaveBeenCalled();
    expect(h.createUser).toHaveBeenCalledTimes(3);
  });

  it("does not look up any invite or package when there is no invite token (existing behavior)", async () => {
    const res = await signup(VALID_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.sessionUserId).toBe("new-user");
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

    expect(h.createUser).not.toHaveBeenCalled();
    expect(h.findInviteByToken).not.toHaveBeenCalled();
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });
});
