import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { getResolvedNutritionTargetsForWeek } from "@/lib/nutrition-target-data";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Returns the Mon-Sun week (default: containing today) of resolved daily
// targets — the Week view's data source. Manual/disabled overrides return
// the same values/absence for every day; only "auto" varies day to day.
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const dateParam = request.nextUrl.searchParams.get("date");
  const date = dateParam && ISO_DATE_RE.test(dateParam) ? dateParam : undefined;

  const week = getResolvedNutritionTargetsForWeek(user.id, date);

  return NextResponse.json({ success: true, data: week });
}
