import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import type { Exertion } from "@/lib/nutrition";
import { getResolvedNutritionTarget } from "@/lib/nutrition-target-data";

const EXERTIONS: Exertion[] = ["low", "medium", "high", "match"];

// Web dashboard's Nutrition hero — same resolver the mobile app and AI coach
// use, with an optional ?tomorrow= override so the Yesterday/Today/Tomorrow
// picker can preview a different planned session without touching the
// member's actual Weekly Training pattern.
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const tomorrowParam = request.nextUrl.searchParams.get("tomorrow");
  const tomorrow = tomorrowParam && EXERTIONS.includes(tomorrowParam as Exertion) ? (tomorrowParam as Exertion) : undefined;

  const target = getResolvedNutritionTarget(user.id, undefined, undefined, tomorrow);

  return NextResponse.json({ success: true, data: target });
}
