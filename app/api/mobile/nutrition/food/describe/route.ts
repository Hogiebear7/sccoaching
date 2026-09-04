import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { buildDietaryContextBlock } from "@/lib/ai-context";
import { interpretFoodDescription, isAiConfigured } from "@/lib/ai";
import { findProfileByUserId, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { checkRateLimit } from "@/lib/rate-limit";

const MAX_DESCRIPTION_LENGTH = 500;
const MAX_NAME_LENGTH = 100;
const MAX_SERVING_LENGTH = 100;

// Own key namespace/budget, same discipline as the photo-scan and
// meal-suggest AI routes.
const DESCRIBE_RATE_LIMIT = 20;
const DESCRIBE_RATE_WINDOW_MS = 10 * 60 * 1000;

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

// POST /api/mobile/nutrition/food/describe
// body: { descriptionText: string, existingItem?: { name, calories, proteinG,
// carbsG, fatG, servingDescription } | null } — a sibling to label-scan for
// the member who'd rather type ("two eggs and toast") or who wants to
// correct an already-identified item in words ("actually that was oat
// milk"). Returns the same IdentifiedFoodItem[] shape as label-scan so both
// paths feed the same review-before-save UI.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, configured: false, message: "Not signed in." }, { status: 401 });
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { success: false, configured: false, message: "Text-to-food isn't available right now." },
      { status: 503 }
    );
  }

  const rate = checkRateLimit(`ai-food-describe:${user.id}`, DESCRIBE_RATE_LIMIT, DESCRIBE_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        success: false,
        configured: true,
        message: `You're doing that quickly — try again in about ${rate.retryAfterSecs > 60 ? `${Math.ceil(rate.retryAfterSecs / 60)} min` : `${rate.retryAfterSecs}s`}.`,
      },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSecs) } }
    );
  }

  const profile = findProfileByUserId(user.id);
  if (!profile) {
    return NextResponse.json({ success: false, configured: true, message: "No profile found for this account." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, configured: true, message: "Invalid JSON body." }, { status: 400 });
  }

  const { descriptionText, existingItem } = (body ?? {}) as Record<string, unknown>;

  if (typeof descriptionText !== "string" || !descriptionText.trim()) {
    return NextResponse.json({ success: false, configured: true, message: "Describe what you ate." }, { status: 400 });
  }

  const ei = (existingItem ?? null) as Record<string, unknown> | null;
  let cleanExistingItem: { name: string; calories: number; proteinG: number; carbsG: number; fatG: number; servingDescription: string } | null = null;

  if (ei) {
    const name = typeof ei.name === "string" ? ei.name.trim().slice(0, MAX_NAME_LENGTH) : "";
    const calories = nonNegativeNumber(ei.calories);
    const proteinG = nonNegativeNumber(ei.proteinG);
    const carbsG = nonNegativeNumber(ei.carbsG);
    const fatG = nonNegativeNumber(ei.fatG);
    const servingDescription = typeof ei.servingDescription === "string" ? ei.servingDescription.trim().slice(0, MAX_SERVING_LENGTH) : "";

    if (name && calories !== null && proteinG !== null && carbsG !== null && fatG !== null) {
      cleanExistingItem = { name, calories, proteinG, carbsG, fatG, servingDescription };
    }
  }

  try {
    const items = await interpretFoodDescription({
      descriptionText: descriptionText.trim().slice(0, MAX_DESCRIPTION_LENGTH),
      existingItem: cleanExistingItem,
      dietaryContext: buildDietaryContextBlock(profile),
      userId: user.id,
    });
    return NextResponse.json({ success: true, configured: true, items });
  } catch (err) {
    console.error(`[food-catalog] text-to-food interpretation failed for user ${user.id}:`, err);
    return NextResponse.json(
      { success: false, configured: true, message: "Couldn't interpret that right now. Please try again." },
      { status: 502 }
    );
  }
}
