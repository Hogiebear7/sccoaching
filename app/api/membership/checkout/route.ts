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
  const hasActiveMembership =
    existingSubscription?.status === "active" &&
    !isPeriodLapsed({ status: existingSubscription.status, currentPeriodEnd: existingSubscription.currentPeriodEnd });

  // Re-buying the exact option you're actively on → nothing to do.
  if (hasActiveMembership && existingSubscription!.billingOptionId === option.id) {
    return NextResponse.json(
      { success: false, message: "You're already on this membership — nothing to do." },
      { status: 409 }
    );
  }

  // ── SWITCH: the member is actively subscribed and picked a DIFFERENT
  // option. Stage it as a pending change WITHOUT touching the active fields,
  // so their current membership and access stay intact until (and unless) the
  // new payment confirms. On confirmation the webhook promotes the pending
  // change and cancels the previous subscription — no duplicate active
  // subscription, no double billing, no proration for the current period.
  if (hasActiveMembership) {
    const sub = existingSubscription!;

    // Duplicate-click / retry: a fresh switch to this same option is already
    // in flight — don't start a second Stripe checkout for it.
    if (
      sub.pendingBillingOptionId === option.id &&
      sub.pendingSetupOrderId &&
      sub.pendingStartedAt &&
      !isPendingCheckoutStale(sub.pendingStartedAt)
    ) {
      return NextResponse.json(
        { success: false, message: "A switch to this option is already in progress. Complete or wait a few minutes." },
        { status: 409 }
      );
    }

    const startedAt = new Date().toISOString();
    // Stage the switch — active fields (packageId/billingOptionId/status/
    // providerSubscriptionId/currentPeriodEnd) are untouched.
    saveSubscription({
      ...sub,
      pendingPackageId: pkg.id,
      pendingBillingOptionId: option.id,
      pendingSetupOrderId: null,
      pendingStartedAt: startedAt,
      updatedAt: startedAt,
    });

    const switchCheckout = await createCatalogCheckout({
      member: { id: user.id, email: user.email },
      option,
      productName: `${pkg.name} — ${option.name}`,
      reference: `${user.id}:switch:${option.id}:${Date.now()}`,
    });

    if (switchCheckout.error || !switchCheckout.sessionId) {
      // Roll the staged switch back so the member is left cleanly on their
      // current membership, exactly as before they clicked.
      saveSubscription({
        ...sub,
        pendingPackageId: null,
        pendingBillingOptionId: null,
        pendingSetupOrderId: null,
        pendingStartedAt: null,
        updatedAt: new Date().toISOString(),
      });
      return NextResponse.json(
        { success: false, message: `Could not start checkout: ${switchCheckout.error ?? "unknown error"}` },
        { status: 502 }
      );
    }

    // Attach the session id so the webhook can find and promote this switch.
    saveSubscription({
      ...sub,
      pendingPackageId: pkg.id,
      pendingBillingOptionId: option.id,
      pendingSetupOrderId: switchCheckout.sessionId,
      pendingStartedAt: startedAt,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json(
      { success: true, checkoutUrl: switchCheckout.checkoutUrl, message: "Redirecting you to checkout to switch." },
      { status: 200 }
    );
  }

  // ── FRESH JOIN / RENEW: no active membership to protect. Existing flow. ──
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
    packageId: pkg.id,
    billingOptionId: option.id,
    status: "pending",
    pausedUntil: null,
    statusBeforePause: null,
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
