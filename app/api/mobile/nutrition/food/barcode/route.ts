import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findFoodByBarcode, findUserById, saveFood } from "@/lib/db";
import { isBarcodeShaped, normalizeOpenFoodFactsProduct } from "@/lib/food-catalog";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { lookupOpenFoodFactsByBarcode } from "@/lib/open-food-facts-client";

// GET /api/mobile/nutrition/food/barcode?code=...
//
// Lookup order (per spec):
//   1. the member's own custom foods tagged with this barcode
//   2. the local branded-food cache (a previous OFF fetch, or an
//      admin-curated branded record)
//   3. a live Open Food Facts lookup — normalized and cached locally so the
//      next scan of the same barcode by anyone hits step 2 instead
//   4. not found — return a trigger so the mobile app opens the label scan
//      flow instead of a dead end
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const code = request.nextUrl.searchParams.get("code") ?? "";
  if (!isBarcodeShaped(code)) {
    return NextResponse.json({ success: false, message: "code must be a UPC/EAN/GTIN digit string." }, { status: 400 });
  }

  // 1. User's own custom foods.
  const customMatch = findFoodByBarcode("custom", code, user.id);
  if (customMatch) {
    return NextResponse.json({ success: true, data: { found: true, food: customMatch } });
  }

  // 2. Local branded cache (previously fetched from OFF, or admin-added).
  const cachedMatch = findFoodByBarcode("branded", code);
  if (cachedMatch) {
    return NextResponse.json({ success: true, data: { found: true, food: cachedMatch } });
  }

  // 3. Live Open Food Facts lookup.
  const lookup = await lookupOpenFoodFactsByBarcode(code);
  if (lookup.ok) {
    const now = new Date().toISOString();
    const food = normalizeOpenFoodFactsProduct(lookup.product, code, randomUUID(), now);
    saveFood(food);
    return NextResponse.json({ success: true, data: { found: true, food } });
  }

  // 4. Not found anywhere — hand off to the label scan flow.
  return NextResponse.json({ success: true, data: { found: false, action: "open_label_scan" } });
}
