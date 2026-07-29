import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  countClassesByCategorySlug,
  countPackagesByEligibleClassType,
  deleteClassCategory,
  findClassCategoryById,
  findUserById,
} from "@/lib/db";
import { verifySession } from "@/lib/session";
import { can } from "@/lib/permissions";

export async function POST(request: NextRequest) {
  const sessionUserId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage categories." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser || !can(staffUser.role, "operations.view")) {
    return NextResponse.json(
      { success: false, message: "Only staff can manage categories." },
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

  const { id } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json(
      { success: false, message: "Category ID is required." },
      { status: 400 }
    );
  }

  const category = findClassCategoryById(id);

  if (!category) {
    return NextResponse.json(
      { success: false, message: "Category not found." },
      { status: 404 }
    );
  }

  // Guarded delete: block while any class or package still references this
  // class type by slug — deleting it would silently orphan those references.
  const classCount = countClassesByCategorySlug(category.slug);
  const packageCount = countPackagesByEligibleClassType(category.slug);

  if (classCount > 0 || packageCount > 0) {
    const parts: string[] = [];
    if (classCount > 0) parts.push(`${classCount} class${classCount === 1 ? "" : "es"}`);
    if (packageCount > 0) parts.push(`${packageCount} package${packageCount === 1 ? "" : "s"}`);
    return NextResponse.json(
      {
        success: false,
        message: `"${category.name}" is still used by ${parts.join(" and ")}. Reassign or remove those first, then delete this class type.`,
      },
      { status: 409 }
    );
  }

  deleteClassCategory(id);

  return NextResponse.json(
    { success: true, message: `"${category.name}" deleted.` },
    { status: 200 }
  );
}
