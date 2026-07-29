import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findMembershipPackageById,
  findSubscriptionByUserId,
  findUserById,
  saveSubscription,
  type SubscriptionRecord,
} from "@/lib/db";
import { verifySession } from "@/lib/session";
import { can } from "@/lib/permissions";

export async function POST(request: NextRequest) {
  const sessionUserId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser || !can(staffUser.role, "members.billing")) {
    return NextResponse.json(
      { success: false, message: "Only staff can activate memberships." },
      { status: 403 }
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

  const { userId, packageId, periodEndIso } = (body ?? {}) as Record<string, unknown>;

  if (typeof userId !== "string" || !userId.trim()) {
    return NextResponse.json(
      { success: false, message: "userId is required." },
      { status: 400 }
    );
  }

  if (typeof packageId !== "string" || !packageId.trim()) {
    return NextResponse.json(
      { success: false, message: "packageId is required." },
      { status: 400 }
    );
  }

  const member = findUserById(userId.trim());

  if (!member) {
    return NextResponse.json(
      { success: false, message: "Member not found." },
      { status: 404 }
    );
  }

  if (member.role !== "member") {
    return NextResponse.json(
      { success: false, message: "Can only activate memberships for member accounts." },
      { status: 400 }
    );
  }

  const pkg = findMembershipPackageById(packageId.trim());

  if (!pkg || !pkg.visible) {
    return NextResponse.json(
      { success: false, message: "This package does not exist or is not available." },
      { status: 404 }
    );
  }

  let resolvedPeriodEnd: string | null = null;

  if (typeof periodEndIso === "string" && periodEndIso.trim()) {
    const d = new Date(periodEndIso.trim());
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json(
        { success: false, message: "periodEndIso must be a valid date string." },
        { status: 400 }
      );
    }
    resolvedPeriodEnd = d.toISOString();
  }

  const now = new Date().toISOString();
  const existing = findSubscriptionByUserId(member.id);

  const subscription: SubscriptionRecord = {
    userId: member.id,
    packageId: pkg.id,
    billingOptionId: null,
    status: "active",
    provider: "none",
    providerCustomerId: existing?.providerCustomerId ?? null,
    providerSubscriptionId: existing?.providerSubscriptionId ?? null,
    providerSetupOrderId: existing?.providerSetupOrderId ?? null,
    currentPeriodEnd: resolvedPeriodEnd,
    lastWebhookEventAt: existing?.lastWebhookEventAt ?? null,
    sessionsUsedThisPeriod: 0,
    extraSessionGrants: [],
    periodLapsedNotifiedAt: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  saveSubscription(subscription);

  const periodNote = resolvedPeriodEnd
    ? ` until ${new Date(resolvedPeriodEnd).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`
    : "";

  return NextResponse.json(
    {
      success: true,
      message: `${member.email} activated on ${pkg.name}${periodNote}. Session count reset to 0.`,
    },
    { status: 200 }
  );
}
