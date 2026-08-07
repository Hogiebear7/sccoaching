import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findFoodEntriesByUserId, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { sumDailyTotals } from "@/lib/nutrition-diary";

// Returns every entry for the requested date plus the summed totals, so the
// client doesn't need to re-derive the math from raw entries.
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const date = request.nextUrl.searchParams.get("date");
  if (!date) {
    return NextResponse.json({ success: false, message: "date is required." }, { status: 400 });
  }

  const entries = findFoodEntriesByUserId(user.id).filter((e) => e.date === date);

  return NextResponse.json({ success: true, data: { entries, totals: sumDailyTotals(entries) } });
}
