import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findClassCategories,
  findMembershipCategoryById,
  findMembershipPackageById,
  findUserById,
  saveMembershipPackage,
  type ClassCategory,
  type MembershipPackageRecord,
  type PackageType,
  type SessionAllowanceType,
} from "@/lib/db";
import { slugifyCatalog } from "@/lib/catalog";
import { verifySession } from "@/lib/session";

const PACKAGE_TYPES: PackageType[] = ["membership", "pass", "top_up"];
const ALLOWANCE_TYPES: SessionAllowanceType[] = ["unlimited", "fixed_count", "single_use"];

export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user || user.role !== "staff") {
    return NextResponse.json({ success: false, message: "Only staff can manage the catalog." }, { status: user ? 403 : 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const {
    id,
    categoryId,
    name,
    shortDescription,
    fullDescription,
    packageType,
    sessionAllowanceType,
    sessionAllowanceCount,
    eligibleClassTypes,
    visible,
    sortOrder,
    stripeProductId,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof categoryId !== "string" || !findMembershipCategoryById(categoryId)) {
    return NextResponse.json({ success: false, message: "A valid category is required." }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ success: false, message: "Package name is required." }, { status: 400 });
  }
  if (typeof packageType !== "string" || !PACKAGE_TYPES.includes(packageType as PackageType)) {
    return NextResponse.json({ success: false, message: "A valid package type is required." }, { status: 400 });
  }
  if (typeof sessionAllowanceType !== "string" || !ALLOWANCE_TYPES.includes(sessionAllowanceType as SessionAllowanceType)) {
    return NextResponse.json({ success: false, message: "A valid session allowance type is required." }, { status: 400 });
  }

  // Count is required for fixed_count; single_use defaults to 1; unlimited = null.
  let allowanceCount: number | null = null;
  if (sessionAllowanceType === "fixed_count") {
    const n = Number(sessionAllowanceCount);
    if (!Number.isInteger(n) || n <= 0 || n > 1000) {
      return NextResponse.json({ success: false, message: "Session count must be a whole number between 1 and 1000." }, { status: 400 });
    }
    allowanceCount = n;
  } else if (sessionAllowanceType === "single_use") {
    allowanceCount = 1;
  }

  // eligibleClassTypes must be known class-category slugs; empty = all.
  const activeSlugs = new Set(findClassCategories().map((c) => c.slug));
  const eligible: ClassCategory[] = Array.isArray(eligibleClassTypes)
    ? Array.from(new Set(eligibleClassTypes.filter((s): s is string => typeof s === "string" && activeSlugs.has(s))))
    : [];

  const existing = typeof id === "string" && id.trim() ? findMembershipPackageById(id) : undefined;
  if (typeof id === "string" && id.trim() && !existing) {
    return NextResponse.json({ success: false, message: "This package no longer exists." }, { status: 404 });
  }

  const now = new Date().toISOString();
  const pkg: MembershipPackageRecord = {
    id: existing?.id ?? randomUUID(),
    categoryId,
    name: name.trim(),
    slug: existing?.slug ?? slugifyCatalog(name.trim()) ?? randomUUID().slice(0, 8),
    shortDescription: typeof shortDescription === "string" && shortDescription.trim() ? shortDescription.trim() : null,
    fullDescription: typeof fullDescription === "string" && fullDescription.trim() ? fullDescription.trim() : null,
    packageType: packageType as PackageType,
    sessionAllowanceType: sessionAllowanceType as SessionAllowanceType,
    sessionAllowanceCount: allowanceCount,
    eligibleClassTypes: eligible,
    visible: typeof visible === "boolean" ? visible : existing?.visible ?? true,
    sortOrder: Number.isFinite(Number(sortOrder)) ? Math.trunc(Number(sortOrder)) : existing?.sortOrder ?? 0,
    stripeProductId: typeof stripeProductId === "string" && stripeProductId.trim() ? stripeProductId.trim() : null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  saveMembershipPackage(pkg);

  return NextResponse.json(
    { success: true, message: existing ? "Package updated." : "Package created." },
    { status: 200 }
  );
}
