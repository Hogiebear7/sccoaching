// Thin wrapper around Open Food Facts' public read API — no API key
// required. Returns the raw vendor JSON; normalization into our internal
// FoodRecord schema happens in lib/food-catalog.ts so nothing downstream of
// that boundary ever sees a raw OFF payload (per the "never expose raw
// vendor payloads to the app" requirement).

const OFF_BASE_URL = "https://world.openfoodfacts.org/api/v2";
const OFF_USER_AGENT = "SCPerformanceCoaching/1.0 (contact: app admin)";

export interface OpenFoodFactsNutriments {
  "energy-kcal_100g"?: number;
  proteins_100g?: number;
  carbohydrates_100g?: number;
  fat_100g?: number;
  fiber_100g?: number;
  sugars_100g?: number;
  sodium_100g?: number;
  "saturated-fat_100g"?: number;
}

export interface OpenFoodFactsProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  serving_size?: string;
  countries_tags?: string[];
  nutriments?: OpenFoodFactsNutriments;
}

export type OpenFoodFactsLookupResult =
  | { ok: true; product: OpenFoodFactsProduct }
  | { ok: false; reason: "not_found" | "network_error" | "invalid_response" };

// GET /api/v2/product/{barcode}.json — status 0 means the barcode isn't in
// OFF's database (a normal, expected outcome, not an error).
export async function lookupOpenFoodFactsByBarcode(barcode: string): Promise<OpenFoodFactsLookupResult> {
  let res: Response;
  try {
    res = await fetch(`${OFF_BASE_URL}/product/${encodeURIComponent(barcode)}.json`, {
      headers: { "User-Agent": OFF_USER_AGENT },
    });
  } catch {
    return { ok: false, reason: "network_error" };
  }

  if (!res.ok) {
    return { ok: false, reason: res.status === 404 ? "not_found" : "network_error" };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: "invalid_response" };
  }

  const body = json as { status?: number; product?: OpenFoodFactsProduct };
  if (body.status !== 1 || !body.product) {
    return { ok: false, reason: "not_found" };
  }

  return { ok: true, product: body.product };
}
