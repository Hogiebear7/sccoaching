import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findMembershipBillingOptionById,
  findMembershipPackageById,
  findPurchaseByIdempotencyKey,
  findSubscriptionByUserId,
  findUserById,
  savePurchase,
  saveSubscription,
  type PurchaseRecord,
  type SubscriptionRecord,
} from "@/lib/db";
import { activeBillingProvider, createCatalogCheckout, isPendingCheckoutStale } from "@/lib/billing";
import { isPeriodLapsed } from "@/lib/membership-status";
import { isPurchaseCheckoutReusable } from "@/lib/payments";
import { verifySession } from "@/lib/session";

// Catalog checkout: the member picked a billing option (a price) under a
// package (the entitlement). Recurring → subscription checkout that the
// webhook activates into a package-backed SubscriptionRecord. One-time →
// a pass-pack PurchaseRecord that the webhook credits by package. Entitlement
// always comes from the package, never from the price.
export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to check out." },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { billingOptionId } = (body ?? {}) as Record<string, unknown>;
  if (typeof billingOptionId !== "string" || !billingOptionId.trim()) {
    return NextResponse.json(
      { success: false, message: "A billing option is required." },
      { status: 400 }
    );
  }

  const option = findMembershipBillingOptionById(billingOptionId.trim());
  const pkg = option ? findMembershipPackageById(option.packageId) : undefined;

  if (!option || !pkg || !option.visible || !pkg.visible) {
    return NextResponse.json(
      { success: false, message: "This option is not available." },
      { status: 404 }
    );
  }

  if (activeBillingProvider() !== "stripe") {
    return NextResponse.json(
      {
        success: false,
        message: "Online payment isn't set up yet. Ask staff about joining at the club.",
      },
      { status: 503 }
    );
  }

  const now = new Date().toISOString();

  // ── One-time: a class pass / top-up purchase ─────────────────────────
  if (option.billingType === "one_time") {
    const key = `${user.id}:catalog:${option.id}`;
    const existing = findPurchaseByIdempotencyKey(key);
    if (existing && existing.userId === user.id && isPurchaseCheckoutReusable(existing)) {
      return NextResponse.json(
        { success: true, checkoutUrl: existing.checkoutUrl, message: "Resuming your existing checkout." },
        { status: 200 }
      );
    }

    const purchase: PurchaseRecord = {
      id: randomUUID(),
      userId: user.id,
      kind: "pass_pack",
      // productId is the PACKAGE — the webhook credits its session count.
      productId: pkg.id,
      description: `${pkg.name} — ${option.name}`,
      amountCents: option.amountCents,
      status: "pending",
      provider: "stripe",
      providerOrderId: null,
      providerPaymentRef: null,
      checkoutUrl: null,
      idempotencyKey: existing ? `${key}:${Date.now()}` : key,
      createdAt: now,
      updatedAt: now,
    };
    savePurchase(purchase);

    const checkout = await createCatalogCheckout({
      member: { id: user.id, email: user.email },
      option,
      productName: `${pkg.name} (${option.name})`,
      reference: purchase.id,
    });

    if (checkout.error || !checkout.sessionId) {
      savePurchase({ ...purchase, status: "failed", updatedAt: new Date().toISOString() });
      return NextResponse.json(
        { success: false, message: "Could not start checkout. Please try again." },
        { status: 502 }
      );
    }

    savePurchase({
      ...purchase,
      providerOrderId: checkout.sessionId,
      checkoutUrl: checkout.checkoutUrl,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json(
      { success: true, checkoutUrl: checkout.checkoutUrl, message: "Redirecting you to checkout." },
      { status: 200 }
    );
  }

  // ── Recurring: a membership subscription ─────────────────────────────
  const existingSubscription = findSubscriptionByUserId(user.id);

  // Prevent re-buying the exact option the member is already actively on
  // (the UI hides its button; this is the server-side guard). Switching to a
  // DIFFERENT option is still allowed — that's a plan change, not a re-buy.
  if (
    existingSubscription?.status === "active" &&
    existingSubscription.billingOptionId === option.id &&
    !isPeriodLapsed({ status: existingSubscription.status, currentPeriodEnd: existingSubscription.currentPeriodEnd })
  ) {
    return NextResponse.json(
      { success: false, message: "You're already on this membership — nothing to do." },
      { status: 409 }
    );
  }

  // Don't stack a duplicate checkout while a fresh one for this exact option
  // is still in progress.
  if (
    existingSubscription?.status === "pending" &&
    existingSubscription.billingOptionId === option.id &&
    !isPendingCheckoutStale(existingSubscription.updatedAt)
  ) {
    return NextResponse.json(
      {
        success: false,
        message: "A checkout for this option is already in progress. Complete or wait a few minutes.",
      },
      { status: 409 }
    );
  }

  const pendingBase: SubscriptionRecord = {
    userId: user.id,
    planId: null,
    packageId: pkg.id,
    billingOptionId: option.id,
    status: "pending",
    provider: "stripe",
    providerCustomerId: existingSubscription?.providerCustomerId ?? null,
    providerSubscriptionId: existingSubscription?.providerSubscriptionId ?? null,
    providerSetupOrderId: null,
    currentPeriodEnd: null,
    lastWebhookEventAt: null,
    // A pending checkout isn't payment confirmation, so usage carries over
    // until the webhook starts a fresh period.
    sessionsUsedThisPeriod: existingSubscription?.sessionsUsedThisPeriod ?? 0,
    extraSessionGrants: existingSubscription?.extraSessionGrants ?? [],
    periodLapsedNotifiedAt: existingSubscription?.periodLapsedNotifiedAt ?? null,
    createdAt: existingSubscription?.createdAt ?? now,
    updatedAt: now,
  };
  saveSubscription(pendingBase);

  const checkout = await createCatalogCheckout({
    member: { id: user.id, email: user.email },
    option,
    productName: `${pkg.name} — ${option.name}`,
    reference: `${user.id}:${option.id}:${Date.now()}`,
  });

  if (checkout.error || !checkout.sessionId) {
    return NextResponse.json(
      { success: false, message: `Could not start checkout: ${checkout.error ?? "unknown error"}` },
      { status: 502 }
    );
  }

  // The webhook finds this subscription by its setup-order (session) id.
  saveSubscription({ ...pendingBase, providerSetupOrderId: checkout.sessionId, updatedAt: new Date().toISOString() });

  return NextResponse.json(
    { success: true, checkoutUrl: checkout.checkoutUrl, message: "Redirecting you to checkout." },
    { status: 200 }
  );
}
