import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  countBillingOptionsByPackageId,
  countSubscriptionsByPackageId,
  deleteMembershipPackage,
  findMembershipPackageById,
  findUserById,
} from "@/lib/db";
import { verifySession } from "@/lib/session";
import { can } from "@/lib/permissions";

// Guarded delete: blocked while the package has billing options or is
// referenced by a subscription (its entitlement is still load-bearing). Hide
// instead.
export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;
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
  if (!pkg) {
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
