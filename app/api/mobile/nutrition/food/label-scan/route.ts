import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { identifyFoodPhoto, isAiConfigured } from "@/lib/ai";
import { findAllFoods, findFoodIdentificationOverridesByUserId, findUserById } from "@/lib/db";
import { applyCatalogMatches } from "@/lib/food-catalog";
import { applyFoodIdentificationOverrides } from "@/lib/food-identification-override";
import { isValidImageDataUrl } from "@/lib/image-upload";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { checkRateLimit } from "@/lib/rate-limit";

// Food photos need more resolution than a small cover thumbnail for the
// model to read a label or distinguish plate contents — same cap as
// meal-suggest.
const MAX_PHOTO_IMAGE_LENGTH = 3_000_000;

// Own key namespace/budget, same discipline as the other AI features.
const SCAN_RATE_LIMIT = 15;
const SCAN_RATE_WINDOW_MS = 10 * 60 * 1000;

// POST /api/mobile/nutrition/food/label-scan
// body: { imageBase64: string } — a data:image/... URL. Triggered either
// directly (member photographs food to log) or when a barcode lookup comes
// back not-found (per the barcode endpoint's `action: "open_label_scan"`).
//
// Returns identified food items (each editable client-side) for the member
// to review before logging — nothing is saved server-side here.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, configured: false, message: "Not signed in." }, { status: 401 });
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { success: false, configured: false, message: "Photo scanning isn't available right now." },
      { status: 503 }
    );
  }

  const rate = checkRateLimit(`ai-food-photo-scan:${user.id}`, SCAN_RATE_LIMIT, SCAN_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        success: false,
        configured: true,
        message: `You're scanning quickly — try again in about ${rate.retryAfterSecs > 60 ? `${Math.ceil(rate.retryAfterSecs / 60)} min` : `${rate.retryAfterSecs}s`}.`,
      },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSecs) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, configured: true, message: "Invalid JSON body." }, { status: 400 });
  }

  const { imageBase64 } = (body ?? {}) as Record<string, unknown>;
  if (typeof imageBase64 !== "string" || !isValidImageDataUrl(imageBase64, MAX_PHOTO_IMAGE_LENGTH)) {
    return NextResponse.json(
      { success: false, configured: true, message: "imageBase64 must be a JPEG/PNG/WebP data URL." },
      { status: 400 }
    );
  }

  try {
    const rawItems = await identifyFoodPhoto({ imageDataUrl: imageBase64, userId: user.id });
    // Swap in verified catalog nutrition for anything the AI only
    // estimated but that already matches a known common/branded food
    // exactly by name — before the member's own manual overrides, which
    // should still win if they've specifically corrected this item before.
    const catalogMatched = applyCatalogMatches(rawItems, findAllFoods("common"), findAllFoods("branded"));
    const overrides = findFoodIdentificationOverridesByUserId(user.id);
    const items = applyFoodIdentificationOverrides(catalogMatched, overrides);
    return NextResponse.json({ success: true, configured: true, items });
  } catch (err) {
    console.error(`[food-catalog] photo identification failed for user ${user.id}:`, err);
    return NextResponse.json(
      { success: false, configured: true, message: "Couldn't read that photo right now. Please try again." },
      { status: 502 }
    );
  }
}
