import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findFoodByBarcode, findFoodById, findUserById, saveFood, type FoodRecord } from "@/lib/db";
import { parseCustomFoodInput } from "@/lib/food-catalog";
import { verifyRequestSession } from "@/lib/mobile-auth";

// Also used to archive/restore a custom food — pass archived: true/false
// alongside the unchanged fields, same convention as workout templates.
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

  const { id, archived } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "id is required." }, { status: 400 });
  }

  const existing = findFoodById("custom", id);
  if (!existing || existing.ownerUserId !== user.id) {
    return NextResponse.json({ success: false, message: "Custom food not found." }, { status: 404 });
  }

  const parsed = parseCustomFoodInput((body ?? {}) as Record<string, unknown>);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  if (parsed.value.barcode) {
    const barcodeOwner = findFoodByBarcode("custom", parsed.value.barcode, user.id);
    if (barcodeOwner && barcodeOwner.id !== id) {
      return NextResponse.json({ success: false, message: "You already have a different custom food saved with this barcode." }, { status: 400 });
    }
  }

  const updated: FoodRecord = {
    ...existing,
    ...parsed.value,
    archivedAt: typeof archived === "boolean" ? (archived ? new Date().toISOString() : null) : existing.archivedAt,
    updatedAt: new Date().toISOString(),
  };

  saveFood(updated);

  return NextResponse.json({ success: true, message: "Custom food updated.", data: updated }, { status: 200 });
}
