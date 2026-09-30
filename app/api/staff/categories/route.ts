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
import { sameGym } from "@/lib/gym-scope";
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

  const existingLookup = typeof id === "string" && id.trim() ? findClassCategoryById(id) : undefined;

  // A category id that resolves to a DIFFERENT gym is treated as not-found,
  // exactly like the catalog category route (app/api/staff/catalog/categories)
  // — never revealed, never silently reused. Falling through with
  // `existing` left undefined means this then proceeds down the CREATE path
  // below (a fresh, own-gym category), rather than editing someone else's.
  const existing = existingLookup && sameGym(staffUser, existingLookup) ? existingLookup : undefined;

  if (existingLookup && !existing) {
    return NextResponse.json(
      { success: false, message: "Category not found." },
      { status: 404 }
    );
  }

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
    // Immutable after creation — an edit never changes who manages this
    // category, and a client-supplied gymId is never read at all. A fresh
    // category is always stamped from the CREATING staff member's own gym.
    gymId: existing ? existing.gymId ?? null : staffUser.gymId ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  saveClassCategory(category);

  return NextResponse.json(
    { success: true, message: existing ? "Category updated." : "Category created." },
    { status: 200 }
  );
}
