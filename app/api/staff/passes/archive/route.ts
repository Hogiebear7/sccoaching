import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findClassPassProductById, findUserById, saveClassPassProduct } from "@/lib/db";
import { verifySession } from "@/lib/session";

// Toggles only isActive. Archived packs disappear from the member purchase
// list and the checkout route refuses them; passes already bought keep
// working — entitlements live on the ledger, not the product.
export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage pass packs." },
      { status: 401 }
    );
  }

  if (user.role !== "staff") {
    return NextResponse.json(
      { success: false, message: "Only staff can manage pass packs." },
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

  const { id, isActive } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json(
      { success: false, message: "A pass pack is required." },
      { status: 400 }
    );
  }

  if (typeof isActive !== "boolean") {
    return NextResponse.json(
      { success: false, message: "isActive must be true or false." },
      { status: 400 }
    );
  }

  const product = findClassPassProductById(id.trim());

  if (!product) {
    return NextResponse.json(
      { success: false, message: "This pass pack no longer exists." },
      { status: 404 }
    );
  }

  saveClassPassProduct({ ...product, isActive, updatedAt: new Date().toISOString() });

  return NextResponse.json(
    {
      success: true,
      message: isActive
        ? `${product.name} is available to members again.`
        : `${product.name} archived — hidden from members. Passes already purchased still work.`,
    },
    { status: 200 }
  );
}
