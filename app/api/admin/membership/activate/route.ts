import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  appendIapEvent,
  findMembershipCategoryById,
  findMembershipPackageById,
  findSubscriptionByUserId,
  findUserById,
  saveSubscription,
  type SubscriptionRecord,
} from "@/lib/db";
import { ownerGymForCatalogPackage, sameGym, staffAuthorizedForCatalogPackage } from "@/lib/gym-scope";
import { evaluateEntitlementConflict, packageScopeResolver, scopeOfPackage } from "@/lib/iap/entitlement-conflict";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;

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

  // The target must be in the acting admin's own gym. A cross-gym target is
  // folded into the same not-found response as a missing one, and this gate
  // runs before the role check, the package lookup, date validation, and
  // saveSubscription — so a foreign account's existence and role aren't
  // revealed. The app-only package exception (below) applies to package
  // ownership only, never to this gate.
  if (!member || !sameGym(staffUser, member)) {
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

  // The package must belong to the acting admin's gym: package -> category
  // -> gymId. A package whose category can't be resolved fails closed;
  // deliveryChannel === "app_only" is the sole global exception (see
  // lib/gym-scope.ts). Folded into the same not-found response as a
  // missing/hidden package so a cross-gym package's existence isn't
  // revealed, and it runs before saveSubscription below.
  const category = pkg ? findMembershipCategoryById(pkg.categoryId) : undefined;
  const ownedByAdminGym = !!pkg && staffAuthorizedForCatalogPackage(staffUser, pkg, category);

  if (!pkg || !pkg.visible || !ownedByAdminGym) {
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

  // This route REPLACES the member's one subscription row. It must not silently replace a live
  // entitlement of the other kind or a live Google Play subscription (see lib/iap/entitlement-conflict.ts).
  const conflict = evaluateEntitlementConflict(existing, { kind: "staff_write", scope: scopeOfPackage(pkg), entitling: true }, packageScopeResolver);
  if (conflict) {
    appendIapEvent({ type: "staff_write_rejected", userId: member.id, actor: "staff", detail: { code: conflict.code, source: "admin_membership_activate" } });
    return NextResponse.json({ success: false, code: conflict.code, message: conflict.message }, { status: 409 });
  }

  const subscription: SubscriptionRecord = {
    userId: member.id,
    packageId: pkg.id,
    billingOptionId: null,
    status: "active",
    pausedUntil: null,
    statusBeforePause: null,
    provider: "none",
    providerCustomerId: existing?.providerCustomerId ?? null,
    providerSubscriptionId: existing?.providerSubscriptionId ?? null,
    providerSetupOrderId: existing?.providerSetupOrderId ?? null,
    currentPeriodEnd: resolvedPeriodEnd,
    lastWebhookEventAt: existing?.lastWebhookEventAt ?? null,
    sessionsUsedThisPeriod: 0,
    extraSessionGrants: [],
    periodLapsedNotifiedAt: null,
    // Immutable historical provenance: if this member already has a row, its
    // ownerGym wins exactly as stored, falling back to explicit "unresolved"
    // (never silently recomputed) for a row that predates this field. Fresh
    // ownership (from the same already-authorized package/category above) is
    // only ever stamped the first time this member gets a subscription row
    // at all.
    ownerGym: existing ? existing.ownerGym ?? { scope: "unresolved" } : ownerGymForCatalogPackage(pkg, category),
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
