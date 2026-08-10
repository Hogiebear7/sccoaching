import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { isValidImageDataUrl } from "@/lib/image-upload";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { ocrProvider } from "@/lib/ocr-provider";

// Nutrition-label photos need more resolution than a small cover thumbnail
// for OCR to have a chance — a larger cap than lib/image-upload.ts's default.
const MAX_LABEL_IMAGE_LENGTH = 3_000_000;

// POST /api/mobile/nutrition/food/label-scan
// body: { imageBase64: string } — a data:image/... URL of the captured
// label. Triggered by the mobile app automatically when a barcode lookup
// comes back not-found (per the barcode endpoint's `action: "open_label_scan"`).
//
// On success, returns a *draft* — every field editable, nothing pre-saved —
// for the member to confirm/correct before it becomes a custom food via
// POST .../food/custom/create. If no OCR provider is configured (the
// default in this repo), responds with code "ocr_not_configured" so the
// mobile app falls back to the blank manual-entry form instead of a dead
// end.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  if (!ocrProvider.configured) {
    return NextResponse.json(
      { success: false, code: "ocr_not_configured", message: "Label scanning isn't available yet — enter the details manually." },
      { status: 501 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { imageBase64 } = (body ?? {}) as Record<string, unknown>;
  if (typeof imageBase64 !== "string" || !isValidImageDataUrl(imageBase64, MAX_LABEL_IMAGE_LENGTH)) {
    return NextResponse.json({ success: false, message: "imageBase64 must be a JPEG/PNG/WebP data URL." }, { status: 400 });
  }

  const result = await ocrProvider.extractNutritionLabel(imageBase64);
  if (!result.ok) {
    return NextResponse.json({ success: false, code: "ocr_failed", message: result.reason }, { status: 502 });
  }

  return NextResponse.json({ success: true, data: { fields: result.fields, rawText: result.rawText } });
}
