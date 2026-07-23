import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  countPackagesByCategoryId,
  deleteMembershipCategory,
  findMembershipCategoryById,
  findUserById,
} from "@/lib/db";
import { verifySession } from "@/lib/session";

// Guarded delete: a category with packages can't be removed (would orphan
// them) — staff hide it instead.
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

  const { id } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "A category is required." }, { status: 400 });
  }

  const category = findMembershipCategoryById(id.trim());
  if (!category) {
    return NextResponse.json({ success: false, message: "This category no longer exists." }, { status: 404 });
  }

  const packageCount = countPackagesByCategoryId(category.id);
  if (packageCount > 0) {
    return NextResponse.json(
      {
        success: false,
        message: `${category.name} has ${packageCount} package${packageCount === 1 ? "" : "s"} — remove or move them first, or hide the category instead.`,
      },
      { status: 409 }
    );
  }

  deleteMembershipCategory(category.id);
  return NextResponse.json({ success: true, message: `${category.name} deleted.` }, { status: 200 });
}
