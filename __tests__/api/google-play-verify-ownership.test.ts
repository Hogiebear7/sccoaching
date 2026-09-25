// Purchase-token ownership for POST /api/mobile/billing/google-play/verify.
// A token already recorded against a DIFFERENT account must be rejected before
// anything is saved, overwritten, acknowledged, granted or booked as revenue;
// the recorded owner and their entitlement stay untouched. The same owner
// re-verifying the same token stays idempotent. The identity used is always
// the signed session user — never a client-supplied user or gym id. Auth uses
// the real signed-session mechanism; the Google API and grant are mocked so the
// assertions are about ordering and what is (not) called.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  createRevenueEvent: vi.fn(),
  findGooglePlayPurchaseByToken: vi.fn(),
  findMembershipBillingOptions: vi.fn(),
  findMembershipPackages: vi.fn(),
  findRevenueEventByProviderRef: vi.fn(),
  saveGooglePlayPurchase: vi.fn(),
  acknowledgeGooglePlaySubscription: vi.fn(),
  isGooglePlayConfigured: vi.fn(),
  mapGooglePlaySubscriptionState: vi.fn(),
  verifyGooglePlaySubscriptionPurchase: vi.fn(),
  grantMemberTier: vi.fn(),
  findUserById: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  findUserById: h.findUserById,
  createRevenueEvent: h.createRevenueEvent,
  findGooglePlayPurchaseByToken: h.findGooglePlayPurchaseByToken,
  findMembershipBillingOptions: h.findMembershipBillingOptions,
  findMembershipPackages: h.findMembershipPackages,
  findRevenueEventByProviderRef: h.findRevenueEventByProviderRef,
  saveGooglePlayPurchase: h.saveGooglePlayPurchase,
}));
vi.mock("@/lib/providers/google-play", () => ({
  acknowledgeGooglePlaySubscription: h.acknowledgeGooglePlaySubscription,
  isGooglePlayConfigured: h.isGooglePlayConfigured,
  mapGooglePlaySubscriptionState: h.mapGooglePlaySubscriptionState,
  verifyGooglePlaySubscriptionPurchase: h.verifyGooglePlaySubscriptionPurchase,
}));
vi.mock("@/lib/tier-grant", () => ({
  APP_SUBSCRIPTION_PACKAGE_SLUG: "app-subscription",
  grantMemberTier: h.grantMemberTier,
}));

const OWNER = "user-owner";
const OTHER = "user-other";
const TOKEN = "play-token-123";

const OPTION = {
  id: "opt-app-monthly",
  googlePlaySubscriptionId: "app_sub",
  googlePlayBasePlanId: "monthly",
  amountCents: 999,
  currency: "EUR",
};
const SUBSCRIPTION = {
  productId: "app_sub",
  basePlanId: "monthly",
  orderId: "GPA.1",
  linkedPurchaseToken: null,
  subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
  acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
  autoRenewing: true,
  startTimeMillis: 1000,
  expiryTimeMillis: Date.now() + 30 * 86_400_000,
};
const EXISTING = {
  id: "purchase-1",
  userId: OWNER,
  purchaseToken: TOKEN,
  productId: "app_sub",
  createdAt: "2026-01-01T00:00:00.000Z",
};

async function verify(body: unknown, sessionUserId?: string, rawBody?: string) {
  const { POST } = await import("@/app/api/mobile/billing/google-play/verify/route");
  return POST(
    new NextRequest("http://localhost/api/mobile/billing/google-play/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sessionUserId
          ? { Cookie: `session=${signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS)}` }
          : {}),
      },
      body: rawBody ?? JSON.stringify(body),
    })
  );
}

function expectNothingWritten() {
  expect(h.saveGooglePlayPurchase).not.toHaveBeenCalled();
  expect(h.acknowledgeGooglePlaySubscription).not.toHaveBeenCalled();
  expect(h.grantMemberTier).not.toHaveBeenCalled();
  expect(h.createRevenueEvent).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sessions resolve only for a live (existing, non-archived) account.
  h.findUserById.mockImplementation((id: string) => ({ id, role: "member", archivedAt: null }));
  h.isGooglePlayConfigured.mockReturnValue(true);
  h.findGooglePlayPurchaseByToken.mockReturnValue(undefined);
  h.verifyGooglePlaySubscriptionPurchase.mockResolvedValue({ ok: true, subscription: SUBSCRIPTION });
  h.findMembershipBillingOptions.mockReturnValue([OPTION]);
  h.findMembershipPackages.mockReturnValue([{ id: "pkg-app", slug: "app-subscription" }]);
  h.mapGooglePlaySubscriptionState.mockReturnValue({ playStatus: "active", appStatus: "active" });
  h.findRevenueEventByProviderRef.mockReturnValue(undefined);
  h.grantMemberTier.mockResolvedValue({ ok: true, tier: "app_subscription" });
});

describe("POST /api/mobile/billing/google-play/verify — token ownership", () => {
  it("accepts a new token: saves it for the session user, grants the tier, records revenue", async () => {
    const res = await verify({ purchaseToken: TOKEN }, OWNER);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      message: "Purchase verified.",
      data: { tier: "app_subscription", status: "active" },
    });
    expect(h.saveGooglePlayPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OWNER, purchaseToken: TOKEN })
    );
    expect(h.grantMemberTier).toHaveBeenCalledWith(OWNER, "app_subscription", expect.objectContaining({ providerSubscriptionId: TOKEN }));
    expect(h.createRevenueEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: OWNER, providerRef: "GPA.1" }));
  });

  it("stays idempotent for the same owner: same id/createdAt kept, tier re-granted to the same user", async () => {
    h.findGooglePlayPurchaseByToken.mockReturnValue(EXISTING);
    h.findRevenueEventByProviderRef.mockReturnValue({ id: "rev-1" }); // this order already booked

    const res = await verify({ purchaseToken: TOKEN }, OWNER);

    expect(res.status).toBe(200);
    expect(h.saveGooglePlayPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ id: "purchase-1", userId: OWNER, createdAt: EXISTING.createdAt })
    );
    expect(h.grantMemberTier).toHaveBeenCalledTimes(1);
    expect(h.grantMemberTier).toHaveBeenCalledWith(OWNER, "app_subscription", expect.anything());
    expect(h.createRevenueEvent).not.toHaveBeenCalled();
  });

  it("rejects a different user replaying a recorded token, before the provider call, writing nothing", async () => {
    h.findGooglePlayPurchaseByToken.mockReturnValue(EXISTING);

    const res = await verify({ purchaseToken: TOKEN }, OTHER);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, message: "This purchase is already linked to another account." });
    expect(h.verifyGooglePlaySubscriptionPurchase).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("leaves the existing owner and entitlement untouched after a rejected claim", async () => {
    // A stateful store: the rejected claim must not change the recorded owner,
    // and the rightful owner's retry must still work afterwards.
    let stored: typeof EXISTING | undefined = { ...EXISTING };
    h.findGooglePlayPurchaseByToken.mockImplementation(() => stored);
    h.saveGooglePlayPurchase.mockImplementation((p: typeof EXISTING) => {
      stored = p;
    });

    const denied = await verify({ purchaseToken: TOKEN }, OTHER);
    expect(denied.status).toBe(409);
    expect(stored?.userId).toBe(OWNER);
    expect(h.grantMemberTier).not.toHaveBeenCalledWith(OTHER, expect.anything(), expect.anything());

    const retry = await verify({ purchaseToken: TOKEN }, OWNER);
    expect(retry.status).toBe(200);
    expect(stored?.userId).toBe(OWNER);
  });

  it("re-checks ownership right before saving, in case another account claims the token during verification", async () => {
    h.findGooglePlayPurchaseByToken.mockReturnValueOnce(undefined).mockReturnValue(EXISTING);

    const res = await verify({ purchaseToken: TOKEN }, OTHER);

    expect(res.status).toBe(409);
    expect(h.verifyGooglePlaySubscriptionPurchase).toHaveBeenCalledTimes(1);
    expectNothingWritten();
  });

  it("ignores a client-supplied userId / gymId: only the session user is ever used", async () => {
    h.findGooglePlayPurchaseByToken.mockReturnValue(EXISTING);

    const spoofed = await verify({ purchaseToken: TOKEN, userId: OWNER, gymId: null }, OTHER);
    expect(spoofed.status).toBe(409);
    expectNothingWritten();

    h.findGooglePlayPurchaseByToken.mockReturnValue(undefined);
    const fresh = await verify({ purchaseToken: "another-token", userId: OWNER, gymId: "gym-x" }, OTHER);
    expect(fresh.status).toBe(200);
    expect(h.saveGooglePlayPurchase).toHaveBeenCalledWith(expect.objectContaining({ userId: OTHER }));
    expect(h.grantMemberTier).toHaveBeenCalledWith(OTHER, "app_subscription", expect.anything());
  });
});

describe("POST /api/mobile/billing/google-play/verify — existing behavior unchanged", () => {
  it("rejects an unauthenticated request with 401 before anything else", async () => {
    const res = await verify({ purchaseToken: TOKEN });

    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe("You must be signed in to verify a purchase.");
    expect(h.findGooglePlayPurchaseByToken).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("returns 503 when Google Play isn't configured", async () => {
    h.isGooglePlayConfigured.mockReturnValue(false);

    const res = await verify({ purchaseToken: TOKEN }, OWNER);

    expect(res.status).toBe(503);
    expectNothingWritten();
  });

  it("preserves request validation (bad JSON, missing/blank token)", async () => {
    const badJson = await verify(undefined, OWNER, "{not json");
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).message).toBe("Invalid JSON body.");

    const noToken = await verify({}, OWNER);
    expect(noToken.status).toBe(400);
    expect((await noToken.json()).message).toBe("A purchase token is required.");

    const blank = await verify({ purchaseToken: "   " }, OWNER);
    expect(blank.status).toBe(400);
    expectNothingWritten();
  });

  it("still returns Google's message with 400 for an invalid token, writing nothing", async () => {
    h.verifyGooglePlaySubscriptionPurchase.mockResolvedValue({ ok: false, message: "Token not recognised." });

    const res = await verify({ purchaseToken: "bogus" }, OWNER);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, message: "Token not recognised." });
    expectNothingWritten();
  });

  it("still rejects a token that doesn't match a known App Subscription product", async () => {
    h.findMembershipBillingOptions.mockReturnValue([]);

    const res = await verify({ purchaseToken: TOKEN }, OWNER);

    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("This purchase doesn't match a known App Subscription product.");
    expectNothingWritten();
  });

  it("still returns 409 'still being processed' for a pending purchase", async () => {
    h.mapGooglePlaySubscriptionState.mockReturnValue({ playStatus: "pending", appStatus: null });

    const res = await verify({ purchaseToken: TOKEN }, OWNER);

    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe("Your purchase is still being processed by Google Play. Try again shortly.");
    expect(h.grantMemberTier).not.toHaveBeenCalled();
  });
});
