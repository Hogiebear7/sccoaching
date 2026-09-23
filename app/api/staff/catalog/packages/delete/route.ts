import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  countBillingOptionsByPackageId,
  countSubscriptionsByPackageId,
  deleteMembershipPackage,
  findMembershipCategoryById,
  findMembershipPackageById,
  findUserById,
} from "@/lib/db";
import { staffAuthorizedForCatalogPackage } from "@/lib/gym-scope";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

// Guarded delete: blocked while the package has billing options or is
// referenced by a subscription (its entitlement is still load-bearing). Hide
// instead.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user || !can(user.role, "catalog.manage")) {
    return NextResponse.json({ success: false, message: "Only staff can manage the catalog." }, { status: user ? 403 : 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { id } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "A package is required." }, { status: 400 });
  }

  const pkg = findMembershipPackageById(id.trim());
  // Cross-gym folded into the same not-found response as a genuinely
  // missing package — the guards and delete below never run for either
  // case. Global (app-only) packages are exempt.
  if (!pkg || !staffAuthorizedForCatalogPackage(user, pkg, findMembershipCategoryById(pkg.categoryId))) {
    return NextResponse.json({ success: false, message: "This package no longer exists." }, { status: 404 });
  }

  const optionCount = countBillingOptionsByPackageId(pkg.id);
  if (optionCount > 0) {
    return NextResponse.json(
      { success: false, message: `${pkg.name} has ${optionCount} billing option${optionCount === 1 ? "" : "s"} — remove them first, or hide the package.` },
      { status: 409 }
    );
  }

  const subCount = countSubscriptionsByPackageId(pkg.id);
  if (subCount > 0) {
    return NextResponse.json(
      { success: false, message: `${pkg.name} is referenced by ${subCount} membership${subCount === 1 ? "" : "s"} — hide it instead of deleting.` },
      { status: 409 }
    );
  }

  deleteMembershipPackage(pkg.id);
  return NextResponse.json({ success: true, message: `${pkg.name} deleted.` }, { status: 200 });
}
