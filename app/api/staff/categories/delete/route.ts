import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  deleteClassCategory,
  findClassCategoryById,
  findUserById,
} from "@/lib/db";
import { verifySession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const sessionUserId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage categories." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser || staffUser.role !== "staff") {
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

  deleteClassCategory(id);

  return NextResponse.json(
    { success: true, message: "Category deleted." },
    { status: 200 }
  );
}
