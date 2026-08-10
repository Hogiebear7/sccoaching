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

// ── Write provider (submission workflow) ─────────────────────────────────
//
// Open Food Facts' write API needs producer/org credentials this repo
// doesn't have — same pattern as lib/ocr-provider.ts: a real interface, a
// default implementation that honestly reports itself unconfigured, and a
// config flag so a future deployment can flip live writes on without
// touching any call site. Every caller must check isOffLiveWriteEnabled()
// before treating a "submitted" outcome as reachable.

export interface OffWriteSubmission {
  barcode: string;
  name: string;
  brandName: string;
  servingLabel: string;
  servingGrams: number;
  nutrition100g: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number | null;
    sugarG: number | null;
    sodiumMg: number | null;
    saturatedFatG: number | null;
  };
  frontPhotoUrl: string | null;
  labelPhotoUrl: string | null;
}

export type OffWriteResult = { ok: true; offProductId: string } | { ok: false; reason: string };

export interface OffSubmissionProvider {
  configured: boolean;
  submit(payload: OffWriteSubmission): Promise<OffWriteResult>;
}

const unconfiguredOffSubmissionProvider: OffSubmissionProvider = {
  configured: false,
  async submit() {
    return { ok: false, reason: "off_write_not_configured" };
  },
};

// Swap this export for a real implementation once OFF producer credentials
// exist — every call site already goes through this single seam.
export const offSubmissionProvider: OffSubmissionProvider = unconfiguredOffSubmissionProvider;

let warnedAboutMisconfiguredFlag = false;

// Both a config flag AND a configured provider must be true — belt-and-
// braces so a stray env var alone can never cause a live external write.
// If someone sets OFF_LIVE_WRITE_ENABLED=true without also wiring a real
// provider, that's very likely a deploy mistake (the flag is a no-op, not
// a crash) — surface it once in the server logs so it doesn't go unnoticed
// silently forever, without spamming on every submission review.
export function isOffLiveWriteEnabled(): boolean {
  const flagSet = process.env.OFF_LIVE_WRITE_ENABLED === "true";
  if (flagSet && !offSubmissionProvider.configured && !warnedAboutMisconfiguredFlag) {
    warnedAboutMisconfiguredFlag = true;
    console.warn(
      "[food-catalog] OFF_LIVE_WRITE_ENABLED=true but no OFF write provider is configured — live writes stay disabled. " +
        "Implement OffSubmissionProvider and replace the offSubmissionProvider export in lib/open-food-facts-client.ts."
    );
  }
  return flagSet && offSubmissionProvider.configured;
}
