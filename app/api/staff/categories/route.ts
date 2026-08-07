import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findClassCategoryById,
  findClassCategoryBySlug,
  findUserById,
  saveClassCategory,
  type ClassCategoryRecord,
} from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;

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

  const { id, name } = (body ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json(
      { success: false, message: "Category name is required." },
      { status: 400 }
    );
  }

  const slug = slugify(name.trim());

  if (!slug) {
    return NextResponse.json(
      { success: false, message: "Category name must contain at least one letter or number." },
      { status: 400 }
    );
  }

  const existing = typeof id === "string" && id.trim() ? findClassCategoryById(id) : undefined;

  // Slug is immutable after creation, so the uniqueness check only applies to
  // new records. Editing a category's display name never changes its slug,
  // so we must not reject a rename whose derived slug collides with a different
  // category's slug.
  if (!existing) {
    const slugConflict = findClassCategoryBySlug(slug);
    if (slugConflict) {
      return NextResponse.json(
        { success: false, message: `A category with the slug "${slug}" already exists.` },
        { status: 400 }
      );
    }
  }

  const now = new Date().toISOString();

  const category: ClassCategoryRecord = {
    id: existing?.id ?? randomUUID(),
    name: name.trim(),
    slug: existing?.slug ?? slug,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  saveClassCategory(category);

  return NextResponse.json(
    { success: true, message: existing ? "Category updated." : "Category created." },
    { status: 200 }
  );
}
