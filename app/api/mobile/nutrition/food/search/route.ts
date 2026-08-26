import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findAllFoods, findCustomFoodsByUserId, findFoodById, findFoodEntriesByUserId, findUserById, saveFood, type FoodDomain } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { normalizeOpenFoodFactsProduct, scoreFoodMatch, searchFoodCatalog } from "@/lib/food-catalog";
import { searchOpenFoodFactsByName } from "@/lib/open-food-facts-client";

// A typed query with too few local matches falls through to a live Open
// Food Facts name search — covers a real branded product ("Mars Bar") that
// nobody has scanned/typed here yet, without pre-downloading OFF's
// multi-million-row catalog. Each new hit is cached into brandedFoods so
// the next person who types the same thing gets an instant local match.
const LIVE_SEARCH_THRESHOLD = 5;

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

  let brandedFoods = findAllFoods("branded");

  const groups = searchFoodCatalog({
    query,
    userEntries: findFoodEntriesByUserId(user.id),
    customFoods: findCustomFoodsByUserId(user.id),
    commonFoods: findAllFoods("common"),
    brandedFoods,
    resolveFood: (domain: FoodDomain, id: string) => findFoodById(domain, id),
  });

  const localMatchCount = groups.custom.length + groups.common.length + groups.branded.length;
  if (query.trim() && localMatchCount < LIVE_SEARCH_THRESHOLD) {
    const liveResult = await searchOpenFoodFactsByName(query);
    if (liveResult.ok && liveResult.products.length > 0) {
      const existingBarcodes = new Set(brandedFoods.map((f) => f.barcode).filter((b): b is string => b !== null));
      const now = new Date().toISOString();
      let addedAny = false;

      for (const product of liveResult.products) {
        if (!product.code || existingBarcodes.has(product.code)) continue;
        const food = normalizeOpenFoodFactsProduct(product, product.code, randomUUID(), now);
        saveFood(food);
        brandedFoods = [...brandedFoods, food];
        existingBarcodes.add(product.code);
        addedAny = true;
      }

      if (addedAny) {
        groups.branded = brandedFoods
          .map((f) => ({ f, score: scoreFoodMatch(query, f) }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 20)
          .map((x) => x.f);
      }
    } else if (!liveResult.ok) {
      console.warn(`[food-catalog] Open Food Facts name search failed for "${query}": ${liveResult.reason}`);
    }
  }

  return NextResponse.json({ success: true, data: groups });
}
