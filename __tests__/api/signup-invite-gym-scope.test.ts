// Signup-time invite redemption:
//   POST /api/auth/signup        (web)
//   POST /api/mobile/auth/signup (mobile)
//
// Both routes resolve the inviter's gym BEFORE creating the account, via
// lib/invites.ts's resolveInviteGymId — createUserWithRole(email,
// passwordHash, "member", gymId) — so the account is born in the inviter's
// own gym, never patched afterward. A client-supplied gymId in the request
// body is never read at all.
//
// Three cases, never conflated (see resolveInviteGymId's own header comment
// for the full rationale):
//   * no invite token at all -> today's explicit, temporary primary-gym
//     default (self-signup policy, unchanged);
//   * a token that resolves cleanly -> the account is created in the
//     INVITER's gym and granted that gym's own default package;
//   * a token that's supplied but invalid/expired/revoked/wrong-email/
//     unresolvable-inviter -> HARD REJECTION. No account is created at all.
//     A supplied token is an explicit "I'm joining this gym" statement, so
//     silently degrading to a primary-gym account would be a real
//     cross-tenant misassignment — this is the one case where an invite
//     problem is NOT treated the same as "no invite was ever given".
//
// The rejection uses the exact same generic message and status as the
// existing duplicate-email rejection ("Unable to create account.", 400), so
// no case here is distinguishable from any other "can't create this
// account" outcome — an attacker learns nothing about whether the token,
// email, inviter, or gym exists.
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
] as const)("%s signup — invite binds the new account to the INVITER's gym, or rejects", (_name, signup) => {
  it("Gym A invite: account created in Gym A (primary/null), granted Gym A's own default package", async () => {
    const res = await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });

    expect(res.status).toBe(201);
    expect(res.sessionUserId).toBe("new-user");
    expect(createdGymIds()).toEqual([null]);
    expect(savedPackageIds()).toEqual(["pkg-a-default"]);
    expect(h.saveSubscription.mock.calls[0][0]).toMatchObject({ userId: "new-user", status: "active" });
    expect(h.redeemInvite).toHaveBeenCalledWith("inv-1", "new-user");
  });

  it("Gym B invite: account created in GYM B, granted GYM B's own default package — never the primary gym's", async () => {
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
    expect(h.createUserWithRole).toHaveBeenCalledWith(NEW_EMAIL, expect.any(String), "member", "gym-b");
  });

  it("with no gym-b package the grant fails closed, but the account still correctly belongs to gym-b", async () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id));
    h.findMembershipPackages.mockReturnValue([PKG_A_DEFAULT, PKG_A_SECOND, PKG_APP]); // no gym-b package

    const res = await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });

    expect(res.status).toBe(201);
    expect(createdGymIds()).toEqual(["gym-b"]);
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
    expect(createdGymIds()).toEqual(["gym-b"]);
    expect(savedPackageIds()).toEqual(["pkg-b-first"]);
    expect(h.findMembershipPackageById).not.toHaveBeenCalled();
    expect(h.saveProfile.mock.calls[0][0]).not.toHaveProperty("gymId");
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

  describe("a SUPPLIED invite that's invalid is a HARD REJECTION — no account, no partial state, ever", () => {
    async function expectRejected(res: SignupResult) {
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Unable to create account.");
      expect(res.sessionUserId).toBeNull();
    }

    it("unknown token", async () => {
      h.findInviteByToken.mockReturnValue(undefined);
      await expectRejected(await signup({ ...VALID_PAYLOAD, inviteToken: "bogus" }));
    });

    it("expired token", async () => {
      h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { status: "expired" }));
      await expectRejected(await signup({ ...VALID_PAYLOAD, inviteToken: "tok" }));
    });

    it("revoked token", async () => {
      h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { status: "revoked" }));
      await expectRejected(await signup({ ...VALID_PAYLOAD, inviteToken: "tok" }));
    });

    it("already-redeemed token", async () => {
      h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { status: "redeemed" }));
      await expectRejected(await signup({ ...VALID_PAYLOAD, inviteToken: "tok" }));
    });

    it("email-mismatched token", async () => {
      h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { email: "someone-else@example.com" }));
      await expectRejected(await signup({ ...VALID_PAYLOAD, inviteToken: "tok" }));
    });

    it("unresolvable inviter (deleted staff account)", async () => {
      h.findInviteByToken.mockReturnValue(invite("deleted-staff-id"));
      await expectRejected(await signup({ ...VALID_PAYLOAD, inviteToken: "tok" }));
    });

    it("every rejection case above produces the IDENTICAL response — no case leaks which reason applied", async () => {
      const cases = [
        () => h.findInviteByToken.mockReturnValue(undefined),
        () => h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { status: "expired" })),
        () => h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { status: "revoked" })),
        () => h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { status: "redeemed" })),
        () => h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { email: "someone-else@example.com" })),
        () => h.findInviteByToken.mockReturnValue(invite("deleted-staff-id")),
      ];
      const bodies = [];
      for (const setup of cases) {
        setup();
        const res = await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });
        bodies.push({ status: res.status, body: res.body });
      }
      // Every one of the 6 rejection cases produced the exact same {status, body}.
      for (const b of bodies) expect(b).toEqual(bodies[0]);
    });

    it("never calls createUserWithRole — no account, not even a partial one", async () => {
      h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { status: "revoked" }));
      await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });
      expect(h.createUserWithRole).not.toHaveBeenCalled();
    });

    it("never consumes the invite or writes a profile/subscription", async () => {
      h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { status: "revoked" }));
      await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });
      expect(h.redeemInvite).not.toHaveBeenCalled();
      expect(h.saveProfile).not.toHaveBeenCalled();
      expect(h.saveSubscription).not.toHaveBeenCalled();
    });

    it("does not create a duplicate-email false-positive on retry: the email is still free after a rejected invite signup", async () => {
      h.findInviteByToken.mockReturnValue(invite(STAFF_B.id, { status: "revoked" }));
      const rejected = await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });
      expect(rejected.status).toBe(400);

      // findUserByEmail still returns undefined (no account was left behind) —
      // a retry with no token, or a valid one, must succeed normally.
      h.findInviteByToken.mockReturnValue(invite(STAFF_B.id)); // now valid
      const retried = await signup({ ...VALID_PAYLOAD, inviteToken: "tok" });
      expect(retried.status).toBe(201);
    });
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
