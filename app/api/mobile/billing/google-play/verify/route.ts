import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  createRevenueEvent,
  findGooglePlayPurchaseByToken,
  findMembershipBillingOptions,
  findMembershipPackages,
  findRevenueEventByProviderRef,
  saveGooglePlayPurchase,
  type GooglePlayPurchaseRecord,
  type GooglePlaySubscriptionStatus,
  type SubscriptionRecord,
} from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import {
  acknowledgeGooglePlaySubscription,
  isGooglePlayConfigured,
  mapGooglePlaySubscriptionState,
  verifyGooglePlaySubscriptionPurchase,
} from "@/lib/providers/google-play";
import { APP_SUBSCRIPTION_PACKAGE_SLUG, grantMemberTier } from "@/lib/tier-grant";

// Called by the mobile app right after react-native-iap reports a
// successful purchase (or on "restore purchases"). The purchase token the
// client hands over is NOT trusted on its own — everything about the
// purchase (is it real, what does it entitle, when does it expire) is
// re-derived from a live call to Google here. Safe to call repeatedly with
// the same token: verification, acknowledgement, and the tier grant are all
// idempotent.
export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  if (!sessionUserId) {
    return NextResponse.json({ success: false, message: "You must be signed in to verify a purchase." }, { status: 401 });
  }

  if (!isGooglePlayConfigured()) {
    return NextResponse.json(
      { success: false, message: "Google Play Billing isn't configured on the server yet." },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { purchaseToken } = (body ?? {}) as Record<string, unknown>;
  if (typeof purchaseToken !== "string" || !purchaseToken.trim()) {
    return NextResponse.json({ success: false, message: "A purchase token is required." }, { status: 400 });
  }

  const verifyResult = await verifyGooglePlaySubscriptionPurchase(purchaseToken.trim());
  if (!verifyResult.ok) {
    return NextResponse.json({ success: false, message: verifyResult.message }, { status: 400 });
  }

  const sub = verifyResult.subscription;

  // Only accept a token for a product we actually recognize as sold under
  // the app-subscription package — guards against a stray/foreign token
  // being used to try to grant tier access. Several billing options can
  // share the same productId now (one Play product, three base plans —
  // monthly/6-month/annual), so this must match on the base plan too, not
  // just the product; matching on productId alone would silently attach
  // whichever plan happens to be first in the array, recording the wrong
  // price. Falls back to a productId-only match for a legacy single-plan
  // setup with no basePlanId recorded.
  const allOptions = findMembershipBillingOptions();
  const billingOption =
    allOptions.find((o) => o.googlePlaySubscriptionId === sub.productId && o.googlePlayBasePlanId === sub.basePlanId) ??
    allOptions.find((o) => o.googlePlaySubscriptionId === sub.productId && !o.googlePlayBasePlanId);
  if (!billingOption) {
    return NextResponse.json(
      { success: false, message: "This purchase doesn't match a known App Subscription product." },
      { status: 400 }
    );
  }

  const { playStatus, appStatus } = mapGooglePlaySubscriptionState(sub.subscriptionState, sub.expiryTimeMillis);

  const now = new Date().toISOString();
  const existingPurchase = findGooglePlayPurchaseByToken(purchaseToken.trim());

  const purchaseRecord: GooglePlayPurchaseRecord = {
    id: existingPurchase?.id ?? randomUUID(),
    userId: sessionUserId,
    purchaseToken: purchaseToken.trim(),
    productId: sub.productId ?? billingOption.googlePlaySubscriptionId!,
    basePlanId: sub.basePlanId,
    orderId: sub.orderId,
    linkedPurchaseToken: sub.linkedPurchaseToken,
    status: playStatus as GooglePlaySubscriptionStatus,
    acknowledged: sub.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    autoRenewing: sub.autoRenewing,
    startTimeMillis: sub.startTimeMillis,
    expiryTimeMillis: sub.expiryTimeMillis,
    createdAt: existingPurchase?.createdAt ?? now,
    updatedAt: now,
  };
  saveGooglePlayPurchase(purchaseRecord);

  // Google auto-refunds an unacknowledged purchase after 3 days — do this
  // every verify call; acknowledging an already-acknowledged token is a
  // safe no-op (see acknowledgeGooglePlaySubscription).
  if (sub.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
    const ackResult = await acknowledgeGooglePlaySubscription(purchaseToken.trim());
    if (ackResult.ok) {
      purchaseRecord.acknowledged = true;
      saveGooglePlayPurchase(purchaseRecord);
    }
    // A failed acknowledgement isn't fatal here — the purchase is still
    // real and still grants tier; Google will simply retry acknowledgement
    // pressure via RTDN, or the next verify call will try again.
  }

  if (appStatus === null) {
    return NextResponse.json(
      {
        success: false,
        message: "Your purchase is still being processed by Google Play. Try again shortly.",
      },
      { status: 409 }
    );
  }

  const grantResult = await grantMemberTier(sessionUserId, "app_subscription", {
    provider: "google_play",
    providerSubscriptionId: purchaseToken.trim(),
    currentPeriodEnd: sub.expiryTimeMillis ? new Date(sub.expiryTimeMillis).toISOString() : null,
    status: appStatus as SubscriptionRecord["status"],
    billingOptionId: billingOption.id,
  });

  if (!grantResult.ok) {
    return NextResponse.json({ success: false, message: grantResult.message }, { status: 500 });
  }

  // Record revenue once per real order (Google's order id), same
  // dedupe-on-providerRef pattern the Revolut webhook uses. Uses the
  // billing option's configured price, since Google's RTDN/verify responses
  // don't carry a charged amount — see billing option header comment about
  // this being a placeholder until the real Play Console price is set.
  if (sub.orderId && appStatus === "active" && !findRevenueEventByProviderRef("google_play", sub.orderId)) {
    const appSubscriptionPackage = findMembershipPackages().find((p) => p.slug === APP_SUBSCRIPTION_PACKAGE_SLUG);
    createRevenueEvent({
      id: randomUUID(),
      userId: sessionUserId,
      packageId: appSubscriptionPackage?.id ?? null,
      billingOptionId: billingOption.id,
      amountCents: billingOption.amountCents,
      currency: billingOption.currency,
      provider: "google_play",
      providerRef: sub.orderId,
      source: "membership_renewal",
      receivedAt: now,
    });
  }

  return NextResponse.json(
    { success: true, message: "Purchase verified.", data: { tier: grantResult.tier, status: appStatus } },
    { status: 200 }
  );
}
