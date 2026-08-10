import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findAllFoods, findCustomFoodsByUserId, findFoodById, findFoodEntriesByUserId, findUserById, type FoodDomain } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { searchFoodCatalog } from "@/lib/food-catalog";

// GET /api/mobile/nutrition/food/search?q=...
// Grouped result order is fixed: History, Custom, Common, Branded (see
// searchFoodCatalog for the within-group ranking rules). An empty/missing
// query returns a light "browsing" result — recent history plus the first
// page of common/branded/custom foods — rather than an empty screen.
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";

  const groups = searchFoodCatalog({
    query,
    userEntries: findFoodEntriesByUserId(user.id),
    customFoods: findCustomFoodsByUserId(user.id),
    commonFoods: findAllFoods("common"),
    brandedFoods: findAllFoods("branded"),
    resolveFood: (domain: FoodDomain, id: string) => findFoodById(domain, id),
  });

  return NextResponse.json({ success: true, data: groups });
}
