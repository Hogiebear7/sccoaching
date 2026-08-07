import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findFoodEntriesByUserId, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { recentDistinctFoods } from "@/lib/nutrition-diary";

// Recently-logged distinct foods for quick re-add — stands in for a food
// database search since there's no external food API integrated.
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  return NextResponse.json({ success: true, data: recentDistinctFoods(findFoodEntriesByUserId(user.id)) });
}
