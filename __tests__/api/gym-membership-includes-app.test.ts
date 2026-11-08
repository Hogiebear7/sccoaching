// Owner decision 2026-11-08: a live gym Membership can include the App Subscription features, behind ONE switch (GYM_MEMBERSHIP_INCLUDES_APP).
// Drives the real access code, AI-budget code and purchase-context routes against a real datastore file (helpers/app-store-fixture.ts).
// Fake ids only. The default (switch unset) is decision D1 and is covered by digital-access-separation.test.ts, which must keep passing.
//
// What these prove:
//   - OFF (unset / anything but "true"): a gym Membership gives no digital features, exactly as before.
//   - ON: a live gym Membership gives every digital feature; it ends with the Membership; nothing is stored, so switching it off restores D1.
//   - AI for a bundled member is drawn from the COMPLIMENTARY allowance (never the paid pool); a store plan or trial still takes precedence.
//   - A bundled member is not offered a store purchase (Google Play or the App Store); someone without a Membership still is.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppStoreFixture, type AppStoreFixture } from "../helpers/app-store-fixture";

let fx: AppStoreFixture;
const DAY = 86_400_000;

const gym = (userId: string, status: "active" | "past_due" | "canceled" | "paused" = "active") =>
  fx.setSubscription(userId, { packageId: fx.ids.membershipPackage, status });
const access = async (userId: string) => (await import("@/lib/membership-entitlement")).resolveMemberAccessForUser(userId);

function paidStoreRow(userId: string, over: Partial<import("@/lib/db").DigitalEntitlementRecord> = {}) {
  const now = new Date().toISOString();
  fx.db.saveDigitalEntitlement({
    id: `app_store:${userId}`,
    userId,
    source: "app_store",
    status: "active",
    productId: "p",
    billingOptionId: fx.ids.appOption,
    storeRefHash: "h".repeat(64),
    environment: "production",
    currentPeriodEnd: new Date(Date.now() + 20 * DAY).toISOString(),
    autoRenewing: true,
    grantedByUserId: null,
    note: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  });
}

beforeEach(async () => {
  fx = await createAppStoreFixture();
});
afterEach(() => {
  vi.unstubAllEnvs();
  fx.cleanup();
});

describe("switch OFF (the default): decision D1 is unchanged", () => {
  it.each([undefined, "", "false", "TRUE ", "1", "yes"])("GYM_MEMBERSHIP_INCLUDES_APP=%j: a gym Membership gives NO digital access", async (value) => {
    if (value !== undefined) vi.stubEnv("GYM_MEMBERSHIP_INCLUDES_APP", value === "TRUE " ? "TRUE" : value);
    gym(fx.memberA.id);
    expect(await access(fx.memberA.id)).toEqual({ digital: false, gymMembership: true });
  });
});

describe("switch ON: a live gym Membership includes the App features", () => {
  beforeEach(() => vi.stubEnv("GYM_MEMBERSHIP_INCLUDES_APP", "true"));

  it("an active gym Membership gives digital access and every digital feature", async () => {
    gym(fx.memberA.id);
    const a = await access(fx.memberA.id);
    expect(a).toEqual({ digital: true, gymMembership: true });
    const { hasAccess } = await import("@/lib/member-access");
    for (const f of ["aiCoachChat", "aiNutritionCoachChat", "workoutGenerate", "fullHistory", "programmes", "calorieTargets", "cyclePhaseGuidance", "unlimitedSavedWorkouts"] as const) {
      expect(hasAccess(a, f), f).toBe(true);
    }
  });

  it("past_due still counts as a live Membership (same rule as coach messaging)", async () => {
    gym(fx.memberA.id, "past_due");
    expect(await access(fx.memberA.id)).toEqual({ digital: true, gymMembership: true });
  });

  it("it ends with the Membership: cancelled or paused means no digital access, and nothing was stored to clean up", async () => {
    gym(fx.memberA.id);
    expect((await access(fx.memberA.id)).digital).toBe(true);
    expect(fx.db.findDigitalEntitlementsByUserId(fx.memberA.id)).toEqual([]);
    gym(fx.memberA.id, "canceled");
    expect(await access(fx.memberA.id)).toEqual({ digital: false, gymMembership: false });
    gym(fx.memberA.id, "paused");
    expect((await access(fx.memberA.id)).digital).toBe(false);
  });

  it("switching it off again puts the same member straight back to D1 (the revert)", async () => {
    gym(fx.memberA.id);
    expect((await access(fx.memberA.id)).digital).toBe(true);
    vi.stubEnv("GYM_MEMBERSHIP_INCLUDES_APP", "false");
    expect(await access(fx.memberA.id)).toEqual({ digital: false, gymMembership: true });
  });

  it("someone with no Membership still gets nothing", async () => {
    expect(await access(fx.memberB.id)).toEqual({ digital: false, gymMembership: false });
  });

  it("the app-only package is not a gym Membership, so it does not trigger the bundle", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "active", provider: "none" });
    expect((await access(fx.memberA.id)).gymMembership).toBe(false);
  });

  it("the member gate answers yes for a bundled member and still says upgrade for a member without one", async () => {
    gym(fx.memberA.id);
    const { requireFeature } = await import("@/lib/member-access-response");
    expect(requireFeature(fx.memberA.id, "aiCoachChat")).toBeNull();
    const refused = requireFeature(fx.memberB.id, "aiCoachChat");
    expect(refused?.status).toBe(403);
  });
});

describe("AI budget for a bundled member", () => {
  it("OFF: a gym-only member is in the free group, as before", async () => {
    gym(fx.memberA.id);
    const { allowanceKindFor } = await import("@/lib/ai-allowance");
    expect(allowanceKindFor(fx.memberA.id, Date.now())).toBe("free");
  });

  it("ON: a gym-only member draws from the COMPLIMENTARY allowance, and can use AI", async () => {
    vi.stubEnv("GYM_MEMBERSHIP_INCLUDES_APP", "true");
    gym(fx.memberA.id);
    const { allowanceKindFor, checkAiAllowance, aiAllowanceBudgets } = await import("@/lib/ai-allowance");
    expect(allowanceKindFor(fx.memberA.id, Date.now())).toBe("complimentary");
    const r = checkAiAllowance(fx.memberA.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe("complimentary");
      expect(r.remainingUsd).toBeCloseTo(aiAllowanceBudgets().complimentary as number);
    }
  });

  it("ON: a member with no Membership is unchanged (free group)", async () => {
    vi.stubEnv("GYM_MEMBERSHIP_INCLUDES_APP", "true");
    const { allowanceKindFor } = await import("@/lib/ai-allowance");
    expect(allowanceKindFor(fx.memberB.id, Date.now())).toBe("free");
  });

  it("ON: a Membership plus a paid store plan uses the PAID allowance, and plus a store trial the trial total", async () => {
    vi.stubEnv("GYM_MEMBERSHIP_INCLUDES_APP", "true");
    gym(fx.memberA.id);
    const { allowanceKindFor } = await import("@/lib/ai-allowance");
    paidStoreRow(fx.memberA.id);
    expect(allowanceKindFor(fx.memberA.id, Date.now())).toBe("paid");
    paidStoreRow(fx.memberA.id, { trial: true });
    expect(allowanceKindFor(fx.memberA.id, Date.now())).toBe("trial");
  });

  it("ON: when the Membership ends the member is back in the free group", async () => {
    vi.stubEnv("GYM_MEMBERSHIP_INCLUDES_APP", "true");
    gym(fx.memberA.id);
    gym(fx.memberA.id, "canceled");
    const { allowanceKindFor } = await import("@/lib/ai-allowance");
    expect(allowanceKindFor(fx.memberA.id, Date.now())).toBe("free");
  });

  it("ON: staff can still pause AI for a bundled member", async () => {
    vi.stubEnv("GYM_MEMBERSHIP_INCLUDES_APP", "true");
    gym(fx.memberA.id);
    const now = new Date().toISOString();
    fx.db.saveProfile({ userId: fx.memberA.id, fullName: "Bundled", createdAt: now, updatedAt: now, aiPausedAt: now } as never);
    const { checkAiAllowance } = await import("@/lib/ai-allowance");
    expect(checkAiAllowance(fx.memberA.id)).toMatchObject({ ok: false, reason: "paused" });
  });
});

describe("no store purchase for a member who already has the features", () => {
  it("ON: the App Store purchase context refuses a bundled member, plainly, and hands out no binding", async () => {
    vi.stubEnv("GYM_MEMBERSHIP_INCLUDES_APP", "true");
    gym(fx.memberA.id);
    const res = await fx.context(fx.memberA.id);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, code: "included_with_membership", message: "Your gym Membership already includes the App features, so there is nothing to buy." });
    expect(JSON.stringify(body)).not.toMatch(/appAccountToken/);
  });

  it("ON: a member without a Membership can still start a purchase", async () => {
    vi.stubEnv("GYM_MEMBERSHIP_INCLUDES_APP", "true");
    const res = await fx.context(fx.memberB.id);
    expect(res.status).toBe(200);
    expect((await res.json()).data.appAccountToken).toBeTruthy();
  });

  it("OFF: a gym member can still start a purchase, as before", async () => {
    gym(fx.memberA.id);
    expect((await fx.context(fx.memberA.id)).status).toBe(200);
  });
});
