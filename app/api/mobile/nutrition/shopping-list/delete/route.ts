import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteShoppingListItem, findShoppingListItemById, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { id } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ success: false, message: "Missing item id." }, { status: 400 });
  }

  const item = findShoppingListItemById(id);
  if (!item || item.userId !== user.id) {
    return NextResponse.json({ success: false, message: "Item not found." }, { status: 404 });
  }

  deleteShoppingListItem(id);
  return NextResponse.json({ success: true, message: "Item removed." });
}
