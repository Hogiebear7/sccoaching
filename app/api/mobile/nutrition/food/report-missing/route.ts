import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createFoodModerationRequest, findUserById, type FoodModerationRequest } from "@/lib/db";
import { isBarcodeShaped } from "@/lib/food-catalog";
import { verifyRequestSession } from "@/lib/mobile-auth";

// A member flags a barcode that came back not-found (or a search that
// didn't turn up what they were looking for) — feeds the staff moderation
// queue so the common/branded catalog gets more complete over time.
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

  const { barcode, queryText, note } = (body ?? {}) as Record<string, unknown>;

  const cleanBarcode = typeof barcode === "string" && barcode.trim() ? barcode.trim() : null;
  const cleanQueryText = typeof queryText === "string" && queryText.trim() ? queryText.trim().slice(0, 200) : null;

  if (!cleanBarcode && !cleanQueryText) {
    return NextResponse.json({ success: false, message: "Provide a barcode or a search query." }, { status: 400 });
  }
  if (cleanBarcode && !isBarcodeShaped(cleanBarcode)) {
    return NextResponse.json({ success: false, message: "barcode must be a UPC/EAN/GTIN digit string." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const request_: FoodModerationRequest = {
    id: randomUUID(),
    userId: user.id,
    barcode: cleanBarcode,
    queryText: cleanQueryText,
    note: typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null,
    status: "open",
    resolvedFoodId: null,
    resolvedByStaffId: null,
    createdAt: now,
    updatedAt: now,
  };

  createFoodModerationRequest(request_);

  return NextResponse.json({ success: true, message: "Thanks — we'll look into it." }, { status: 201 });
}
