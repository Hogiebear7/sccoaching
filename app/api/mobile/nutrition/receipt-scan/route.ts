import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { extractReceiptItems, isAiConfigured } from "@/lib/ai";
import { findUserById } from "@/lib/db";
import { isValidImageDataUrl } from "@/lib/image-upload";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { checkRateLimit } from "@/lib/rate-limit";

// Same generous cap as meal-suggest/label-scan — receipt text needs enough
// resolution to actually be legible.
const MAX_IMAGE_LENGTH = 3_000_000;

// Own key namespace/budget, same discipline as meal-suggest's rate limit.
const SCAN_RATE_LIMIT = 15;
const SCAN_RATE_WINDOW_MS = 10 * 60 * 1000;

// Reads a receipt photo into a list of candidate line items for the member
// to review/edit on-device (mobile meal-suggest.tsx's confirm stage) —
// deliberately returns whatever it can read rather than silently returning
// nothing, since a blank result here would otherwise look identical to "no
// receipt shown" from the member's side with no way to recover.
export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, configured: false, message: "You must be signed in." },
      { status: 401 }
    );
  }

  const user = findUserById(sessionUserId);

  if (!user) {
    return NextResponse.json(
      { success: false, configured: false, message: "You must be signed in." },
      { status: 401 }
    );
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { success: false, configured: false, message: "Receipt scanning isn't available right now." },
      { status: 503 }
    );
  }

  const rate = checkRateLimit(`ai-receipt-scan:${user.id}`, SCAN_RATE_LIMIT, SCAN_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        success: false,
        configured: true,
        message: `You're scanning receipts quickly — try again in about ${rate.retryAfterSecs > 60 ? `${Math.ceil(rate.retryAfterSecs / 60)} min` : `${rate.retryAfterSecs}s`}.`,
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

  const cleanImage =
    typeof imageBase64 === "string" && isValidImageDataUrl(imageBase64, MAX_IMAGE_LENGTH) ? imageBase64 : null;

  if (!cleanImage) {
    return NextResponse.json(
      { success: false, configured: true, message: "Add a photo of your receipt." },
      { status: 400 }
    );
  }

  try {
    const items = await extractReceiptItems({ imageDataUrl: cleanImage });
    return NextResponse.json({ success: true, configured: true, items });
  } catch (err) {
    console.error("Receipt scan failed:", err);
    return NextResponse.json(
      { success: false, configured: true, message: "Couldn't read that receipt right now. Please try again." },
      { status: 502 }
    );
  }
}
