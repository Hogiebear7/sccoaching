// Confirms the RTDN webhook (app/api/webhooks/google-play/route.ts) never
// needs, reads, or trusts a client-supplied account binding: it only ever
// re-verifies an ALREADY-linked purchase token against Google, and updates
// the persisted record via `{ ...existingPurchase, ... }` — so
// obfuscatedExternalAccountId (set once, at first-claim time, by the verify
// route) survives every subsequent renewal/cancellation/refund update
// untouched. Synthetic data only.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createRevenueEvent: vi.fn(),
  findGooglePlayPurchaseByToken: vi.fn(),
  findMembershipBillingOptions: vi.fn(),
  findMembershipPackages: vi.fn(),
  findRevenueEventByProviderRef: vi.fn(),
  saveGooglePlayPurchase: vi.fn(),
  mapGooglePlaySubscriptionState: vi.fn(),
  verifyGooglePlaySubscriptionPurchase: vi.fn(),
  grantMemberTier: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  createRevenueEvent: h.createRevenueEvent,
  findGooglePlayPurchaseByToken: h.findGooglePlayPurchaseByToken,
  findMembershipBillingOptions: h.findMembershipBillingOptions,
  findMembershipPackages: h.findMembershipPackages,
  findRevenueEventByProviderRef: h.findRevenueEventByProviderRef,
  saveGooglePlayPurchase: h.saveGooglePlayPurchase,
}));
vi.mock("@/lib/providers/google-play", () => ({
  mapGooglePlaySubscriptionState: h.mapGooglePlaySubscriptionState,
  verifyGooglePlaySubscriptionPurchase: h.verifyGooglePlaySubscriptionPurchase,
}));
vi.mock("@/lib/tier-grant", () => ({
  APP_SUBSCRIPTION_PACKAGE_SLUG: "app-subscription",
  grantMemberTier: h.grantMemberTier,
}));

const OWNER = "user-owner";
const TOKEN = "play-token-webhook-1";
const RTDN_SECRET = "test-rtdn-shared-secret";

const EXISTING_PURCHASE = {
  id: "purchase-1",
  userId: OWNER,
  purchaseToken: TOKEN,
  productId: "app_sub",
  basePlanId: "monthly",
  obfuscatedExternalAccountId: "hmac-value-set-at-first-claim",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function pubSubEnvelope(notification: Record<string, unknown>) {
  return { message: { data: Buffer.from(JSON.stringify(notification)).toString("base64") } };
}

async function postWebhook(notification: Record<string, unknown>, token: string | null = RTDN_SECRET) {
  const { POST } = await import("@/app/api/webhooks/google-play/route");
  const url = token
    ? `http://localhost/api/webhooks/google-play?token=${encodeURIComponent(token)}`
    : "http://localhost/api/webhooks/google-play";
  return POST(
    new NextRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pubSubEnvelope(notification)),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_PLAY_RTDN_TOKEN = RTDN_SECRET;
  h.findGooglePlayPurchaseByToken.mockReturnValue(EXISTING_PURCHASE);
  h.findMembershipBillingOptions.mockReturnValue([]);
  h.findMembershipPackages.mockReturnValue([]);
  h.findRevenueEventByProviderRef.mockReturnValue(undefined);
  h.mapGooglePlaySubscriptionState.mockReturnValue({ playStatus: "canceled", appStatus: "canceled" });
  h.grantMemberTier.mockResolvedValue({ ok: true, tier: "free" });
  h.verifyGooglePlaySubscriptionPurchase.mockResolvedValue({
    ok: true,
    subscription: {
      productId: "app_sub",
      basePlanId: "monthly",
      orderId: null,
      linkedPurchaseToken: null,
      subscriptionState: "SUBSCRIPTION_STATE_CANCELED",
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
      autoRenewing: false,
      startTimeMillis: 1000,
      expiryTimeMillis: Date.now() - 1000,
      obfuscatedExternalAccountId: null,
    },
  });
});

describe("RTDN webhook — revenue event ownership", () => {
  it("stamps a new revenue event with platform scope on an active renewal", async () => {
    h.findMembershipBillingOptions.mockReturnValue([
      { id: "opt-app-monthly", googlePlaySubscriptionId: "app_sub", googlePlayBasePlanId: "monthly", amountCents: 999, currency: "eur" },
    ]);
    h.mapGooglePlaySubscriptionState.mockReturnValue({ playStatus: "active", appStatus: "active" });
    h.grantMemberTier.mockResolvedValue({ ok: true, tier: "app_subscription" });
    h.verifyGooglePlaySubscriptionPurchase.mockResolvedValue({
      ok: true,
      subscription: {
        productId: "app_sub",
        basePlanId: "monthly",
        orderId: "GPA.renewal-1",
        linkedPurchaseToken: null,
        subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
        acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
        autoRenewing: true,
        startTimeMillis: 1000,
        expiryTimeMillis: Date.now() + 30 * 86_400_000,
        obfuscatedExternalAccountId: EXISTING_PURCHASE.obfuscatedExternalAccountId,
      },
    });

    const res = await postWebhook({
      packageName: "com.example.app",
      eventTimeMillis: String(Date.now()),
      subscriptionNotification: { version: "1.0", notificationType: 2, purchaseToken: TOKEN, subscriptionId: "app_sub" },
    });

    expect(res.status).toBe(200);
    expect(h.createRevenueEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OWNER, providerRef: "GPA.renewal-1", ownerGym: { scope: "platform" } })
    );
  });
});

describe("RTDN webhook — obfuscatedExternalAccountId preserved, never client-trusted", () => {
  it("11/12. a cancellation/revocation notification preserves the originally-recorded binding and updates entitlement based only on the persisted owner", async () => {
    const res = await postWebhook({
      packageName: "com.example.app",
      eventTimeMillis: String(Date.now()),
      subscriptionNotification: { version: "1.0", notificationType: 3, purchaseToken: TOKEN, subscriptionId: "app_sub" },
    });

    expect(res.status).toBe(200);
    expect(h.saveGooglePlayPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        obfuscatedExternalAccountId: EXISTING_PURCHASE.obfuscatedExternalAccountId,
      })
    );
    // The notification body itself carries no user/account identity at all —
    // only a purchaseToken — so the grant is issued for the token's
    // PERSISTED owner, never anything read from the request.
    expect(h.grantMemberTier).toHaveBeenCalledWith(OWNER, "app_subscription", expect.anything());
  });

  it("12. a notification for a token with no persisted owner is ignored, not used to bind a new account", async () => {
    h.findGooglePlayPurchaseByToken.mockReturnValue(undefined);

    const res = await postWebhook({
      packageName: "com.example.app",
      eventTimeMillis: String(Date.now()),
      subscriptionNotification: { version: "1.0", notificationType: 3, purchaseToken: "unlinked-token", subscriptionId: "app_sub" },
    });

    expect(res.status).toBe(200);
    expect(h.saveGooglePlayPurchase).not.toHaveBeenCalled();
    expect(h.grantMemberTier).not.toHaveBeenCalled();
  });
});
