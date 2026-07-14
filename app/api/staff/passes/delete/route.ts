import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  countPurchasesByProductId,
  deleteClassPassProduct,
  findClassPassProductById,
  findUserById,
} from "@/lib/db";
import { verifySession } from "@/lib/session";

// Hard-deletes a pass-pack product, but only when no purchase of any status
// references it — a referenced product's name and pricing back purchase
// history and refunds, so it must be archived instead.
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

  const { id } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json(
      { success: false, message: "A pass pack is required." },
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

  const references = countPurchasesByProductId(product.id);

  if (references > 0) {
    return NextResponse.json(
      {
        success: false,
        message: `${product.name} has ${references} purchase${references === 1 ? "" : "s"} on record and can't be deleted. Archive it instead to stop new sales.`,
      },
      { status: 409 }
    );
  }

  deleteClassPassProduct(product.id);

  return NextResponse.json(
    { success: true, message: `${product.name} deleted.` },
    { status: 200 }
  );
}
