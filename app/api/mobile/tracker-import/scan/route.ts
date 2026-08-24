import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { extractTrackerStats, isAiConfigured } from "@/lib/ai";
import { findUserById } from "@/lib/db";
import { isValidImageDataUrl } from "@/lib/image-upload";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { checkRateLimit } from "@/lib/rate-limit";

// Fitness-tracker screenshots vary widely (a full dashboard photo needs more
// resolution than a food label) — same cap as the other AI photo features.
const MAX_PHOTO_IMAGE_LENGTH = 3_000_000;

// Own key namespace/budget, same discipline as the other AI features.
const SCAN_RATE_LIMIT = 15;
const SCAN_RATE_WINDOW_MS = 10 * 60 * 1000;

// POST /api/mobile/tracker-import/scan
// body: { imageBase64: string } — a data:image/... URL of a fitness
// tracker/wearable app screenshot (Garmin, Whoop, Fitbit, Huawei Health,
// Samsung Health, Coros, Polar, Oura, etc). Returns whatever stats could be
// read for the member to review before it's used to prefill a logged
// workout or a recovery check-in — nothing is saved server-side here.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, configured: false, message: "Not signed in." }, { status: 401 });
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { success: false, configured: false, message: "Tracker import isn't available right now." },
      { status: 503 }
    );
  }

  const rate = checkRateLimit(`ai-tracker-import:${user.id}`, SCAN_RATE_LIMIT, SCAN_RATE_WINDOW_MS);
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
    const stats = await extractTrackerStats({ imageDataUrl: imageBase64 });
    return NextResponse.json({ success: true, configured: true, stats });
  } catch (err) {
    console.error(`[tracker-import] extraction failed for user ${user.id}:`, err);
    return NextResponse.json(
      { success: false, configured: true, message: "Couldn't read that photo right now. Please try again." },
      { status: 502 }
    );
  }
}
