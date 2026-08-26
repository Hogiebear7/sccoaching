import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findFoodByBarcode, findUserById, saveFood, type FoodRecord } from "@/lib/db";
import { parseCustomFoodInput } from "@/lib/food-catalog";
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

  const parsed = parseCustomFoodInput((body ?? {}) as Record<string, unknown>);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  // Requirement: future scans of a barcode already saved to one of the
  // member's custom foods should resolve to that food, not create a
  // duplicate — so reject a second custom food claiming the same barcode.
  if (parsed.value.barcode && findFoodByBarcode("custom", parsed.value.barcode, user.id)) {
    return NextResponse.json({ success: false, message: "You already have a custom food saved with this barcode." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const food: FoodRecord = {
    id: randomUUID(),
    domain: "custom",
    ...parsed.value,
    imageUrl: null,
    provenance: "user",
    sourceRef: null,
    verified: false,
    region: null,
    ownerUserId: user.id,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    fetchedAt: null,
  };

  saveFood(food);

  return NextResponse.json({ success: true, message: "Custom food saved.", data: food }, { status: 201 });
}
