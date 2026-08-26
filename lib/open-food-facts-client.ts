// Thin wrapper around Open Food Facts' public read API — no API key
// required. Returns the raw vendor JSON; normalization into our internal
// FoodRecord schema happens in lib/food-catalog.ts so nothing downstream of
// that boundary ever sees a raw OFF payload (per the "never expose raw
// vendor payloads to the app" requirement).

const OFF_BASE_URL = "https://world.openfoodfacts.org/api/v2";
const OFF_SEARCH_URL = "https://search.openfoodfacts.org/search";
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
const LOOKUP_TIMEOUT_MS = 10_000;

export async function lookupOpenFoodFactsByBarcode(barcode: string): Promise<OpenFoodFactsLookupResult> {
  let res: Response;
  try {
    // AbortSignal.timeout is the primary cap on the fetch itself, but a
    // production hang (see git history on this file — a stuck lookup here
    // once stalled the whole housekeeping cron job past GitHub Actions'
    // curl timeout, with the response never coming back at all) means that
    // alone isn't proven reliable on every runtime. Racing it against an
    // independent setTimeout is redundant on a host where AbortSignal.timeout
    // works correctly, but guarantees this function still returns control to
    // its caller within LOOKUP_TIMEOUT_MS even if the signal doesn't actually
    // abort the underlying connection.
    res = await Promise.race([
      fetch(`${OFF_BASE_URL}/product/${encodeURIComponent(barcode)}.json`, {
        headers: { "User-Agent": OFF_USER_AGENT },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("lookup timed out")), LOOKUP_TIMEOUT_MS);
      }),
    ]);
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

// GET search.openfoodfacts.org/search?q=... — free-text product search, for
// the case a typed name (e.g. "mars bar") isn't a barcode and isn't in our
// local branded cache yet. This is the modern Search-a-licious endpoint;
// its hit shape differs slightly from the v2 product-lookup shape above
// (brands comes back as a string array, not a comma-joined string; no
// serving_size field is exposed at all), so results are mapped onto the
// same OpenFoodFactsProduct shape here — callers never need to know the two
// endpoints look different on the wire.
const SEARCH_TIMEOUT_MS = 8_000;
const SEARCH_PAGE_SIZE = 10;

interface OffSearchHit {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  brands?: string[];
  serving_size?: string;
  countries_tags?: string[];
  nutriments?: OpenFoodFactsNutriments;
}

export type OpenFoodFactsSearchResult =
  | { ok: true; products: OpenFoodFactsProduct[] }
  | { ok: false; reason: "network_error" | "invalid_response" };

export async function searchOpenFoodFactsByName(query: string): Promise<OpenFoodFactsSearchResult> {
  const q = query.trim();
  if (!q) return { ok: true, products: [] };

  let res: Response;
  try {
    // Same belt-and-braces timeout race as the barcode lookup above — a
    // hung external search must never hang the member's own search screen.
    res = await Promise.race([
      fetch(`${OFF_SEARCH_URL}?q=${encodeURIComponent(q)}&page_size=${SEARCH_PAGE_SIZE}`, {
        headers: { "User-Agent": OFF_USER_AGENT },
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("search timed out")), SEARCH_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return { ok: false, reason: "network_error" };
  }

  if (!res.ok) {
    return { ok: false, reason: "network_error" };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: "invalid_response" };
  }

  const hits = (json as { hits?: OffSearchHit[] }).hits ?? [];
  const products: OpenFoodFactsProduct[] = hits
    // OFF is community-submitted — plenty of entries have a name and
    // barcode but never got nutrition filled in. Surfacing a 0-kcal result
    // is worse than not surfacing it at all: it looks like a real "this
    // food has zero calories" answer, not "we don't actually know."
    .filter((h) => h.code && (h.product_name || h.product_name_en) && (h.nutriments?.["energy-kcal_100g"] ?? 0) > 0)
    .map((h) => ({
      code: h.code,
      product_name: h.product_name || h.product_name_en,
      brands: h.brands?.join(", "),
      serving_size: h.serving_size,
      countries_tags: h.countries_tags,
      nutriments: h.nutriments,
    }));

  return { ok: true, products };
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
