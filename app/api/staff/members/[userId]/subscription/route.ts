import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findMembershipPackageById,
  findSubscriptionByUserId,
  findUserById,
  saveSubscription,
  type SubscriptionRecord,
  type SubscriptionStatus,
} from "@/lib/db";
import { verifySession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { cancelProviderSubscription } from "@/lib/billing";

const STATUS_VALUES: SubscriptionStatus[] = [
  "inactive",
  "pending",
  "active",
  "past_due",
  "canceled",
];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const sessionUserId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage memberships." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage memberships." },
      { status: 401 }
    );
  }

  if (!can(staffUser.role, "members.billing")) {
    return NextResponse.json(
      { success: false, message: "Only staff can manage memberships." },
      { status: 403 }
    );
  }

  const { userId } = await params;
  const member = findUserById(userId);

  if (!member) {
    return NextResponse.json(
      { success: false, message: "Member not found." },
      { status: 404 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { status, packageId } = (body ?? {}) as Record<string, unknown>;

  if (typeof status !== "string" || !STATUS_VALUES.includes(status as SubscriptionStatus)) {
    return NextResponse.json(
      { success: false, message: "A valid status is required." },
      { status: 400 }
    );
  }

  const existingSubscription = findSubscriptionByUserId(member.id);
  const resolvedPackageId =
    typeof packageId === "string" && packageId.trim()
      ? packageId.trim()
      : existingSubscription?.packageId ?? null;

  if (resolvedPackageId && !findMembershipPackageById(resolvedPackageId)) {
    return NextResponse.json(
      { success: false, message: "This package does not exist." },
      { status: 404 }
    );
  }

  if (!resolvedPackageId) {
    return NextResponse.json(
      { success: false, message: "A package is required to set a membership status." },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  // Switching into "active" (or onto a different package) starts a fresh
  // billing period as far as this app is concerned, so the session count
  // resets. Re-saving an already-active subscription on the same package
  // doesn't touch usage.
  const isEnteringFreshActivePeriod =
    status === "active" &&
    (existingSubscription?.status !== "active" || existingSubscription?.packageId !== resolvedPackageId);

  // A manual staff override always records provider: "none" — it's separate
  // from the Revolut-backed flow (cash payment, comp membership, correcting
  // a stuck state, etc). It does not touch any in-flight Revolut order.
  //
  // But if the member currently has a LIVE Stripe subscription, walking away
  // from it locally without also cancelling it at the provider would leave
  // Stripe billing them indefinitely with nothing surfacing the mismatch —
  // so cancel it first. Best-effort: a provider failure is reported back to
  // staff rather than silently swallowed, but doesn't block the local status
  // change (the override may be exactly what's needed to correct a stuck
  // state).
  let providerCancelWarning: string | null = null;

  if (existingSubscription?.provider === "stripe" && existingSubscription.providerSubscriptionId) {
    const result = await cancelProviderSubscription({
      provider: "stripe",
      providerSubscriptionId: existingSubscription.providerSubscriptionId,
    });

    if (!result.ok) {
      providerCancelWarning = `Membership status updated, but the live Stripe subscription could not be cancelled automatically (${result.message ?? "unknown error"}). Cancel it manually in the Stripe dashboard.`;
    }
  }

  const subscription: SubscriptionRecord = {
    userId: member.id,
    packageId: resolvedPackageId,
    billingOptionId: existingSubscription?.billingOptionId ?? null,
    status: status as SubscriptionStatus,
    provider: "none",
    providerCustomerId: existingSubscription?.providerCustomerId ?? null,
    providerSubscriptionId: existingSubscription?.providerSubscriptionId ?? null,
    providerSetupOrderId: existingSubscription?.providerSetupOrderId ?? null,
    currentPeriodEnd: existingSubscription?.currentPeriodEnd ?? null,
    lastWebhookEventAt: existingSubscription?.lastWebhookEventAt ?? null,
    sessionsUsedThisPeriod: isEnteringFreshActivePeriod
      ? 0
      : existingSubscription?.sessionsUsedThisPeriod ?? 0,
    extraSessionGrants: isEnteringFreshActivePeriod
      ? []
      : existingSubscription?.extraSessionGrants ?? [],
    periodLapsedNotifiedAt: isEnteringFreshActivePeriod
      ? null
      : existingSubscription?.periodLapsedNotifiedAt ?? null,
    createdAt: existingSubscription?.createdAt ?? now,
    updatedAt: now,
  };

  saveSubscription(subscription);

  return NextResponse.json(
    { success: true, message: providerCancelWarning ?? "Membership status updated.", warning: providerCancelWarning },
    { status: 200 }
  );
}
