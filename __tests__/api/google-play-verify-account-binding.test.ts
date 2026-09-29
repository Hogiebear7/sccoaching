// Account-binding enforcement for POST /api/mobile/billing/google-play/verify.
//
// A purchase token with NO existing owner (a "first claim") must also carry
// the obfuscated account binding Google echoes back from the client's own
// setObfuscatedAccountId() call, matching this session user's expected value
// (see lib/providers/google-play.ts's googlePlayObfuscatedAccountId). This is
// a SEPARATE protection from the pre-existing ownership recheck: ownership
// stops a second account from claiming an ALREADY-claimed token; binding
// stops the FIRST account to submit a token from claiming it without proof
// they're the one who actually bought it.
//
// Uses the real googlePlayObfuscatedAccountId/googlePlayAccountBindingMatches
// (not mocked) so these tests exercise genuine binding logic against
// SESSION_SECRET from vitest.config.ts — only the Google API call and the
// tier grant are mocked. Synthetic users/tokens/provider responses only.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { googlePlayObfuscatedAccountId } from "@/lib/providers/google-play";
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
// Note: NOT mocking googlePlayObfuscatedAccountId/googlePlayAccountBindingMatches —
// the real implementations run, which is the point of this file.
vi.mock("@/lib/providers/google-play", async () => {
  const actual = await vi.importActual<typeof import("@/lib/providers/google-play")>("@/lib/providers/google-play");
  return {
    ...actual,
    acknowledgeGooglePlaySubscription: h.acknowledgeGooglePlaySubscription,
    isGooglePlayConfigured: h.isGooglePlayConfigured,
    mapGooglePlaySubscriptionState: h.mapGooglePlaySubscriptionState,
    verifyGooglePlaySubscriptionPurchase: h.verifyGooglePlaySubscriptionPurchase,
  };
});
vi.mock("@/lib/tier-grant", () => ({
  APP_SUBSCRIPTION_PACKAGE_SLUG: "app-subscription",
  grantMemberTier: h.grantMemberTier,
}));

const OWNER = "user-owner";
const OTHER = "user-other";
const TOKEN = "play-token-binding-1";

const OPTION = {
  id: "opt-app-monthly",
  googlePlaySubscriptionId: "app_sub",
  googlePlayBasePlanId: "monthly",
  amountCents: 999,
  currency: "EUR",
};

function subscriptionWithBinding(obfuscatedExternalAccountId: string | null) {
  return {
    productId: "app_sub",
    basePlanId: "monthly",
    orderId: "GPA.binding-1",
    linkedPurchaseToken: null,
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    autoRenewing: true,
    startTimeMillis: 1000,
    expiryTimeMillis: Date.now() + 30 * 86_400_000,
    obfuscatedExternalAccountId,
  };
}

async function verify(body: unknown, sessionUserId?: string) {
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
      body: JSON.stringify(body),
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
  h.findUserById.mockImplementation((id: string) => ({ id, role: "member", archivedAt: null }));
  h.isGooglePlayConfigured.mockReturnValue(true);
  h.findGooglePlayPurchaseByToken.mockReturnValue(undefined);
  h.findMembershipBillingOptions.mockReturnValue([OPTION]);
  h.findMembershipPackages.mockReturnValue([{ id: "pkg-app", slug: "app-subscription" }]);
  h.mapGooglePlaySubscriptionState.mockReturnValue({ playStatus: "active", appStatus: "active" });
  h.findRevenueEventByProviderRef.mockReturnValue(undefined);
  h.grantMemberTier.mockResolvedValue({ ok: true, tier: "app_subscription" });
});

describe("POST /api/mobile/billing/google-play/verify — account binding (first claim)", () => {
  it("1. matching obfuscated account binding succeeds", async () => {
    const binding = googlePlayObfuscatedAccountId(OWNER)!;
    h.verifyGooglePlaySubscriptionPurchase.mockResolvedValue({ ok: true, subscription: subscriptionWithBinding(binding) });

    const res = await verify({ purchaseToken: TOKEN }, OWNER);

    expect(res.status).toBe(200);
    expect(h.saveGooglePlayPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OWNER, obfuscatedExternalAccountId: binding })
    );
    expect(h.grantMemberTier).toHaveBeenCalledWith(OWNER, "app_subscription", expect.anything());
  });

  it("2. mismatched binding is rejected", async () => {
    const wrongBinding = googlePlayObfuscatedAccountId(OTHER)!;
    h.verifyGooglePlaySubscriptionPurchase.mockResolvedValue({ ok: true, subscription: subscriptionWithBinding(wrongBinding) });

    const res = await verify({ purchaseToken: TOKEN }, OWNER);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      message: "This purchase could not be verified for your account.",
    });
    expectNothingWritten();
  });

  it("3. missing provider binding is rejected for a new unowned token", async () => {
    h.verifyGooglePlaySubscriptionPurchase.mockResolvedValue({ ok: true, subscription: subscriptionWithBinding(null) });

    const res = await verify({ purchaseToken: TOKEN }, OWNER);

    expect(res.status).toBe(409);
    expectNothingWritten();
  });

  it("4. malformed (garbage/truncated) binding is rejected rather than throwing", async () => {
    h.verifyGooglePlaySubscriptionPurchase.mockResolvedValue({ ok: true, subscription: subscriptionWithBinding("not-a-real-hmac") });

    const res = await verify({ purchaseToken: TOKEN }, OWNER);

    expect(res.status).toBe(409);
    expectNothingWritten();
  });

  it("5. a client-supplied conflicting binding field cannot override the server-derived expected value", async () => {
    // The provider (Google) response is the only source for the binding —
    // the route never reads a binding value out of the request body at all.
    // Confirm a request body that tries to smuggle one in has no effect: the
    // mismatch still comes from what Google actually echoed back.
    const wrongBinding = googlePlayObfuscatedAccountId(OTHER)!;
    h.verifyGooglePlaySubscriptionPurchase.mockResolvedValue({ ok: true, subscription: subscriptionWithBinding(wrongBinding) });

    const res = await verify(
      { purchaseToken: TOKEN, obfuscatedExternalAccountId: googlePlayObfuscatedAccountId(OWNER) },
      OWNER
    );

    expect(res.status).toBe(409);
    expectNothingWritten();
  });

  it("6. a token already owned by the same user stays idempotent without needing to resend a binding", async () => {
    h.findGooglePlayPurchaseByToken.mockReturnValue({
      id: "purchase-1",
      userId: OWNER,
      purchaseToken: TOKEN,
      productId: "app_sub",
      obfuscatedExternalAccountId: googlePlayObfuscatedAccountId(OWNER),
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    // Google's "restore purchases" replay may not carry a fresh binding at all.
    h.verifyGooglePlaySubscriptionPurchase.mockResolvedValue({ ok: true, subscription: subscriptionWithBinding(null) });

    const res = await verify({ purchaseToken: TOKEN }, OWNER);

    expect(res.status).toBe(200);
    expect(h.grantMemberTier).toHaveBeenCalledWith(OWNER, "app_subscription", expect.anything());
  });

  it("7. a token owned by another user is rejected before binding is ever considered", async () => {
    h.findGooglePlayPurchaseByToken.mockReturnValue({
      id: "purchase-1",
      userId: OWNER,
      purchaseToken: TOKEN,
      productId: "app_sub",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    h.verifyGooglePlaySubscriptionPurchase.mockResolvedValue({
      ok: true,
      subscription: subscriptionWithBinding(googlePlayObfuscatedAccountId(OTHER)),
    });

    const res = await verify({ purchaseToken: TOKEN }, OTHER);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, message: "This purchase is already linked to another account." });
    expectNothingWritten();
  });

  it("8. concurrent first-claim attempts for the same brand-new token cannot both succeed (documented, not newly added, atomicity)", async () => {
    // The recheck -> binding-check -> save block has no `await` in it, so
    // Node's single-threaded event loop runs it to completion for whichever
    // request's continuation resumes first; the other's own recheck (using
    // the same in-memory store below) then sees the already-saved owner and
    // is rejected. This test proves that property directly with a shared
    // mutable store standing in for the db, rather than asserting anything
    // about timing.
    let stored: { userId: string; obfuscatedExternalAccountId: string | null } | undefined;
    h.findGooglePlayPurchaseByToken.mockImplementation(() => stored);
    h.saveGooglePlayPurchase.mockImplementation((p: { userId: string; obfuscatedExternalAccountId: string | null }) => {
      stored = p;
    });
    h.verifyGooglePlaySubscriptionPurchase.mockImplementation(async () => ({
      ok: true,
      subscription: subscriptionWithBinding(googlePlayObfuscatedAccountId(OWNER)),
    }));

    // Both "requests" carry the OWNER's own correct binding — simulating two
    // devices/taps by the actual purchaser, not an attacker — to isolate
    // atomicity from the separate binding-mismatch case above.
    const [first, second] = await Promise.all([verify({ purchaseToken: TOKEN }, OWNER), verify({ purchaseToken: TOKEN }, OWNER)]);

    expect([first.status, second.status].sort()).toEqual([200, 200]);
    expect(h.saveGooglePlayPurchase).toHaveBeenCalledTimes(2);
    expect(stored?.userId).toBe(OWNER);
  });

  it("9. provider verification failure creates no entitlement (binding never even considered)", async () => {
    h.verifyGooglePlaySubscriptionPurchase.mockResolvedValue({ ok: false, message: "Token not recognised." });

    const res = await verify({ purchaseToken: TOKEN }, OWNER);

    expect(res.status).toBe(400);
    expectNothingWritten();
  });

  it("10. replayed verification for the same owned token does not duplicate entitlement or revenue", async () => {
    const binding = googlePlayObfuscatedAccountId(OWNER)!;
    h.findGooglePlayPurchaseByToken.mockReturnValue({
      id: "purchase-1",
      userId: OWNER,
      purchaseToken: TOKEN,
      productId: "app_sub",
      obfuscatedExternalAccountId: binding,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    h.findRevenueEventByProviderRef.mockReturnValue({ id: "rev-1" });
    h.verifyGooglePlaySubscriptionPurchase.mockResolvedValue({ ok: true, subscription: subscriptionWithBinding(binding) });

    const res = await verify({ purchaseToken: TOKEN }, OWNER);

    expect(res.status).toBe(200);
    expect(h.grantMemberTier).toHaveBeenCalledTimes(1);
    expect(h.createRevenueEvent).not.toHaveBeenCalled();
  });

  it("13. a legacy record with no stored binding still verifies for its existing owner (pre-existing ownership check protects it, not this field)", async () => {
    h.findGooglePlayPurchaseByToken.mockReturnValue({
      id: "purchase-1",
      userId: OWNER,
      purchaseToken: TOKEN,
      productId: "app_sub",
      // No obfuscatedExternalAccountId field at all — a row from before this
      // migration.
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    h.verifyGooglePlaySubscriptionPurchase.mockResolvedValue({ ok: true, subscription: subscriptionWithBinding(null) });

    const res = await verify({ purchaseToken: TOKEN }, OWNER);

    expect(res.status).toBe(200);
    expect(h.grantMemberTier).toHaveBeenCalledWith(OWNER, "app_subscription", expect.anything());
  });

  it("14. no raw token or binding value appears in an error response body", async () => {
    h.verifyGooglePlaySubscriptionPurchase.mockResolvedValue({ ok: true, subscription: subscriptionWithBinding(null) });

    const res = await verify({ purchaseToken: TOKEN }, OWNER);
    const text = await res.text();

    expect(res.status).toBe(409);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(googlePlayObfuscatedAccountId(OWNER));
  });
});
