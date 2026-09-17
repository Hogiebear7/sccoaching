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
import { mapGooglePlaySubscriptionState, verifyGooglePlaySubscriptionPurchase } from "@/lib/providers/google-play";
import { parsePubSubPushEnvelope, verifyRtdnToken } from "@/lib/providers/google-play-rtdn";
import { APP_SUBSCRIPTION_PACKAGE_SLUG, grantMemberTier } from "@/lib/tier-grant";

// Google Play RTDN push endpoint — Pub/Sub delivers every subscription
// lifecycle event here (renewal, cancellation, grace period, on-hold,
// expiry, revocation, ...). Every notification is treated purely as a "go
// re-check this purchase token" wake-up signal: this handler always calls
// the Android Publisher API fresh rather than trusting notificationType,
// the same "provider state is never the entitlement source of truth"
// principle documented on the commerce records in lib/db.ts, and the same
// stance the member-facing verify route takes toward the client's own
// purchase claim.
//
// Response codes matter here — Pub/Sub retries with backoff on anything
// outside 2xx. 401 for a bad/missing token (a retry won't fix
// misconfiguration, but silently 200'ing it would hide the problem). 502 for
// a transient Google API failure (genuinely worth retrying). 200 for
// everything this handler successfully considered, including "nothing to do"
// cases like a test notification or an unrecognized token.
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!verifyRtdnToken(token)) {
    return NextResponse.json({ error: "Invalid or missing token." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: true, message: "Ignored: invalid JSON." }, { status: 200 });
  }

  const notification = parsePubSubPushEnvelope(body);
  if (!notification) {
    return NextResponse.json({ ok: true, message: "Ignored: unrecognized payload." }, { status: 200 });
  }

  if (notification.testNotification) {
    return NextResponse.json({ ok: true, message: "Test notification received." }, { status: 200 });
  }

  const purchaseToken = notification.subscriptionNotification?.purchaseToken;
  if (!purchaseToken) {
    return NextResponse.json({ ok: true, message: "Ignored: no purchase token in notification." }, { status: 200 });
  }

  const existingPurchase = findGooglePlayPurchaseByToken(purchaseToken);
  if (!existingPurchase) {
    // A purchase token is only linked to a member the first time the mobile
    // app's own verify call succeeds, right after purchase. If a
    // notification somehow arrives before that link exists there's no user
    // to act on — not an error worth retrying over.
    return NextResponse.json(
      { ok: true, message: "Ignored: purchase token not yet linked to a member." },
      { status: 200 }
    );
  }

  const verifyResult = await verifyGooglePlaySubscriptionPurchase(purchaseToken);
  if (!verifyResult.ok) {
    return NextResponse.json({ error: verifyResult.message }, { status: 502 });
  }

  const sub = verifyResult.subscription;
  const { playStatus, appStatus } = mapGooglePlaySubscriptionState(sub.subscriptionState, sub.expiryTimeMillis);

  const now = new Date().toISOString();
  const updatedPurchase: GooglePlayPurchaseRecord = {
    ...existingPurchase,
    productId: sub.productId ?? existingPurchase.productId,
    basePlanId: sub.basePlanId,
    orderId: sub.orderId,
    linkedPurchaseToken: sub.linkedPurchaseToken,
    status: playStatus as GooglePlaySubscriptionStatus,
    acknowledged: existingPurchase.acknowledged || sub.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    autoRenewing: sub.autoRenewing,
    startTimeMillis: sub.startTimeMillis,
    expiryTimeMillis: sub.expiryTimeMillis,
    updatedAt: now,
  };
  saveGooglePlayPurchase(updatedPurchase);

  if (appStatus === null) {
    // Ambiguous/pending Play state — recorded above, but not confident
    // enough to touch entitlement. Google sends a follow-up notification
    // once it resolves.
    return NextResponse.json(
      { ok: true, message: "Purchase state recorded; not confident enough to update tier yet." },
      { status: 200 }
    );
  }

  // Match on base plan too, not just product — see the verify route's
  // identical comment; several billing options can now share a productId
  // (one Play product, three base plans), so productId alone would pick an
  // arbitrary plan's price for revenue recording.
  const allOptions = findMembershipBillingOptions();
  const billingOption =
    allOptions.find(
      (o) => o.googlePlaySubscriptionId === updatedPurchase.productId && o.googlePlayBasePlanId === updatedPurchase.basePlanId
    ) ?? allOptions.find((o) => o.googlePlaySubscriptionId === updatedPurchase.productId && !o.googlePlayBasePlanId);

  const grantResult = await grantMemberTier(existingPurchase.userId, "app_subscription", {
    provider: "google_play",
    providerSubscriptionId: purchaseToken,
    currentPeriodEnd: sub.expiryTimeMillis ? new Date(sub.expiryTimeMillis).toISOString() : null,
    status: appStatus as SubscriptionRecord["status"],
    billingOptionId: billingOption?.id ?? null,
  });

  if (!grantResult.ok) {
    return NextResponse.json({ error: grantResult.message }, { status: 500 });
  }

  if (sub.orderId && appStatus === "active" && billingOption && !findRevenueEventByProviderRef("google_play", sub.orderId)) {
    const appSubscriptionPackage = findMembershipPackages().find((p) => p.slug === APP_SUBSCRIPTION_PACKAGE_SLUG);
    createRevenueEvent({
      id: randomUUID(),
      userId: existingPurchase.userId,
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

  return NextResponse.json({ ok: true, tier: grantResult.tier, status: appStatus }, { status: 200 });
}
