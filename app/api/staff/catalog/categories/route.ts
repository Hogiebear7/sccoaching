import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findMembershipCategoryById,
  findUserById,
  saveMembershipCategory,
  type MembershipCategoryRecord,
} from "@/lib/db";
import { slugifyCatalog } from "@/lib/catalog";
import { verifySession } from "@/lib/session";

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

  const { id, name, description, sortOrder, visible } = (body ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ success: false, message: "Category name is required." }, { status: 400 });
  }

  const existing = typeof id === "string" && id.trim() ? findMembershipCategoryById(id) : undefined;
  if (typeof id === "string" && id.trim() && !existing) {
    return NextResponse.json({ success: false, message: "This category no longer exists." }, { status: 404 });
  }

  const now = new Date().toISOString();
  const category: MembershipCategoryRecord = {
    id: existing?.id ?? randomUUID(),
    name: name.trim(),
    // Slug is stable once created (it may back Stripe/analytics references).
    slug: existing?.slug ?? slugifyCatalog(name.trim()) ?? randomUUID().slice(0, 8),
    description: typeof description === "string" && description.trim() ? description.trim() : null,
    sortOrder: Number.isFinite(Number(sortOrder)) ? Math.trunc(Number(sortOrder)) : existing?.sortOrder ?? 0,
    visible: typeof visible === "boolean" ? visible : existing?.visible ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  saveMembershipCategory(category);

  return NextResponse.json(
    { success: true, message: existing ? "Category updated." : "Category created." },
    { status: 200 }
  );
}
