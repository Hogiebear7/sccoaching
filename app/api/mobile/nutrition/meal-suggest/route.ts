import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { buildDietaryContextBlock } from "@/lib/ai-context";
import { generateMealSuggestions, isAiConfigured } from "@/lib/ai";
import { findProfileByUserId, findUserById } from "@/lib/db";
import { isValidImageDataUrl } from "@/lib/image-upload";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { checkRateLimit } from "@/lib/rate-limit";

// Same generous cap as label-scan — food photos need enough resolution to
// actually identify ingredients, well past the 500,000-byte generic cover cap.
const MAX_IMAGE_LENGTH = 3_000_000;
const MAX_INGREDIENTS_TEXT_LENGTH = 1000;

// Own key namespace, own budget — same discipline as the nutrition coach
// chat route, kept separate so features don't share a rate limit.
const SUGGEST_RATE_LIMIT = 15;
const SUGGEST_RATE_WINDOW_MS = 10 * 60 * 1000;

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
      { success: false, configured: false, message: "Meal suggestions aren't available right now." },
      { status: 503 }
    );
  }

  const rate = checkRateLimit(`ai-meal-suggest:${user.id}`, SUGGEST_RATE_LIMIT, SUGGEST_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        success: false,
        configured: true,
        message: `You're requesting suggestions quickly — try again in about ${rate.retryAfterSecs > 60 ? `${Math.ceil(rate.retryAfterSecs / 60)} min` : `${rate.retryAfterSecs}s`}.`,
      },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSecs) } }
    );
  }

  const profile = findProfileByUserId(user.id);
  if (!profile) {
    return NextResponse.json(
      { success: false, configured: true, message: "No profile found for this account." },
      { status: 404 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, configured: true, message: "Invalid JSON body." }, { status: 400 });
  }

  const { imageBase64, ingredientsText } = (body ?? {}) as Record<string, unknown>;

  const cleanImage =
    typeof imageBase64 === "string" && isValidImageDataUrl(imageBase64, MAX_IMAGE_LENGTH) ? imageBase64 : null;
  const cleanIngredients =
    typeof ingredientsText === "string" ? ingredientsText.trim().slice(0, MAX_INGREDIENTS_TEXT_LENGTH) : "";

  if (!cleanImage && !cleanIngredients) {
    return NextResponse.json(
      { success: false, configured: true, message: "Add a photo or type what you've got." },
      { status: 400 }
    );
  }

  try {
    const suggestions = await generateMealSuggestions({
      imageDataUrl: cleanImage,
      ingredientsText: cleanIngredients || null,
      dietaryContext: buildDietaryContextBlock(profile),
      userId: user.id,
    });

    return NextResponse.json({ success: true, configured: true, suggestions });
  } catch (err) {
    console.error("Meal suggestion generation failed:", err);
    return NextResponse.json(
      { success: false, configured: true, message: "Couldn't generate suggestions right now. Please try again." },
      { status: 502 }
    );
  }
}
