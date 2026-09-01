import type { FoodDomain, FoodEntryRecord, FoodNutrition100g, FoodRecord, FoodServing } from "./db";
import type { OpenFoodFactsProduct } from "./open-food-facts-client";

// ── Barcode validation ──────────────────────────────────────────────────
// UPC-A(12) / EAN-8 / EAN-13 / GTIN-14 — all are digit strings with a
// trailing GS1 mod-10 check digit computed the same way regardless of
// length, so one function covers all four.
const BARCODE_LENGTHS = [8, 12, 13, 14];

export function isBarcodeShaped(value: string): boolean {
  return /^\d+$/.test(value) && BARCODE_LENGTHS.includes(value.length);
}

export function isValidGtinChecksum(code: string): boolean {
  if (!/^\d+$/.test(code) || !BARCODE_LENGTHS.includes(code.length)) return false;
  const digits = code.split("").map(Number);
  const checkDigit = digits.pop() as number;
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += digits[i] * weight;
    weight = weight === 3 ? 1 : 3;
  }
  const calculated = (10 - (sum % 10)) % 10;
  return calculated === checkDigit;
}

// ── Typo-tolerant text matching ─────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost));
    }
    prev = row;
  }
  return prev[b.length];
}

// 1 = identical, 0 = completely different.
export function stringSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// Higher is better; 0 means "not a match, exclude it". Deliberately a single
// scoring function shared by every domain (custom/common/branded) and
// history so ranking behaves identically everywhere — only the candidate
// pool differs per group.
const TYPO_TOLERANCE_THRESHOLD = 0.6;

export function scoreFoodMatch(query: string, food: Pick<FoodRecord, "name" | "brandName" | "barcode">): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  if (food.barcode && food.barcode === query.trim()) return 1000;

  const name = food.name.toLowerCase();
  const brand = food.brandName?.toLowerCase() ?? "";
  const combined = brand ? `${brand} ${name}` : name;

  if (name === q) return 500;
  if (name.startsWith(q)) return 300;
  if (name.includes(q) || combined.includes(q)) return 200;

  const similarity = Math.max(stringSimilarity(q, name), brand ? stringSimilarity(q, brand) : 0);
  return similarity >= TYPO_TOLERANCE_THRESHOLD ? similarity * 150 : 0;
}

// A member's country (ProfileRecord.country, ISO alpha-2) nudges ranking
// toward foods scoped to that same country (FoodRecord.region, normalized
// to alpha-2 — see normalizeOffCountryTag) when the text match is otherwise
// tied or close. The boost is deliberately smaller than the gap between any
// two scoreFoodMatch tiers (the tightest gap is 150 fuzzy-max → 200
// contains, a gap of 50) so it can only reorder within a relevance tier,
// never promote a worse text match above a better one — text relevance
// stays primary, country is a tie-breaker.
const COUNTRY_MATCH_BOOST = 10;

function applyCountryBoost(score: number, food: Pick<FoodRecord, "region">, country: string | null | undefined): number {
  if (score <= 0 || !country || !food.region) return score;
  return food.region.toUpperCase() === country.toUpperCase() ? score + COUNTRY_MATCH_BOOST : score;
}

export function rankByTextMatch(query: string, foods: FoodRecord[], limit: number, country?: string | null): FoodRecord[] {
  if (!query.trim()) return foods.slice(0, limit);
  return foods
    .map((f) => ({ f, score: applyCountryBoost(scoreFoodMatch(query, f), f, country) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.f);
}

// ── History (derived, not a stored domain) ──────────────────────────────
// Only entries that reference a resolvable catalog food can be "logged
// again" with correct serving math — pure free-hand entries (no per-100g
// basis) aren't eligible for the History group. This is a deliberate scope
// line, not an oversight: see docs/food-catalog.md.
export function getFoodHistory(
  userEntries: FoodEntryRecord[],
  resolveFood: (domain: FoodDomain, id: string) => FoodRecord | undefined,
  query: string,
  limit = 20
): FoodRecord[] {
  const mostRecentByFood = new Map<string, { food: FoodRecord; lastLoggedAt: string }>();

  for (const entry of userEntries) {
    if (!entry.foodId || !entry.foodDomain) continue;
    const food = resolveFood(entry.foodDomain, entry.foodId);
    if (!food || food.archivedAt) continue;
    const existing = mostRecentByFood.get(food.id);
    if (!existing || entry.createdAt > existing.lastLoggedAt) {
      mostRecentByFood.set(food.id, { food, lastLoggedAt: entry.createdAt });
    }
  }

  let list = [...mostRecentByFood.values()];
  const q = query.trim();

  if (q) {
    list = list
      .map((x) => ({ ...x, score: scoreFoodMatch(q, x.food) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.lastLoggedAt.localeCompare(a.lastLoggedAt));
  } else {
    list = list.sort((a, b) => b.lastLoggedAt.localeCompare(a.lastLoggedAt));
  }

  return list.slice(0, limit).map((x) => x.food);
}

// ── Grouped search ───────────────────────────────────────────────────────
// Requirement: results grouped History → Custom → Common → Branded (fixed
// section order, for the UI to render as sectioned lists); WITHIN each
// section, ranked by the priority chain (exact barcode > exact/startsWith/
// substring text > typo-tolerant fuzzy match), with History additionally
// weighted by recency. An exact barcode hit floats to the top of whichever
// section actually contains it — it isn't pulled into its own section,
// since the dedicated barcode endpoint (not this one) is the primary path
// for a literal scan.
export interface FoodSearchGroups {
  history: FoodRecord[];
  custom: FoodRecord[];
  common: FoodRecord[];
  branded: FoodRecord[];
}

export function searchFoodCatalog(params: {
  query: string;
  userEntries: FoodEntryRecord[];
  customFoods: FoodRecord[];
  commonFoods: FoodRecord[];
  brandedFoods: FoodRecord[];
  resolveFood: (domain: FoodDomain, id: string) => FoodRecord | undefined;
  limit?: number;
  // Member's ProfileRecord.country (ISO alpha-2) — see applyCountryBoost.
  // History is deliberately excluded: recency is already its secondary
  // ranking signal (see getFoodHistory), and re-litigating that with a
  // second signal isn't worth the complexity for a "recently logged"
  // list that's already personal to the member.
  country?: string | null;
}): FoodSearchGroups {
  const { query, userEntries, customFoods, commonFoods, brandedFoods, resolveFood, limit = 20, country } = params;

  return {
    history: getFoodHistory(userEntries, resolveFood, query, limit),
    custom: rankByTextMatch(query, customFoods, limit, country),
    common: rankByTextMatch(query, commonFoods, limit, country),
    branded: rankByTextMatch(query, brandedFoods, limit, country),
  };
}

// ── Serving / gram math ──────────────────────────────────────────────────
// Canonical nutrition is always per 100g; a serving is just a labelled gram
// conversion layered on top, so any serving × quantity reduces to the same
// scaling math.
export function gramsForServing(food: Pick<FoodRecord, "servings" | "defaultServing">, servingLabel: string | null, quantity: number): number {
  const serving = servingLabel ? (food.servings.find((s) => s.label === servingLabel) ?? food.defaultServing) : food.defaultServing;
  return serving.grams * Math.max(0, quantity);
}

function scaleOrNull(value: number | null, factor: number): number | null {
  return value === null ? null : Math.round(value * factor * 10) / 10;
}

export function nutritionForGrams(n100: FoodNutrition100g, grams: number): FoodNutrition100g {
  const factor = grams / 100;
  return {
    calories: Math.round(n100.calories * factor),
    proteinG: scaleOrNull(n100.proteinG, factor) ?? 0,
    carbsG: scaleOrNull(n100.carbsG, factor) ?? 0,
    fatG: scaleOrNull(n100.fatG, factor) ?? 0,
    fiberG: scaleOrNull(n100.fiberG, factor),
    sugarG: scaleOrNull(n100.sugarG, factor),
    sodiumMg: n100.sodiumMg === null ? null : Math.round(n100.sodiumMg * factor),
    saturatedFatG: scaleOrNull(n100.saturatedFatG, factor),
  };
}

// ── Photo-scan ↔ catalog cross-check ─────────────────────────────────────
// The AI photo-identification tool (lib/ai.ts identifyFoodPhoto) reads
// printed labels exactly ("label") but otherwise gives its own numeric
// estimate ("estimate") for anything it recognizes by sight alone — even
// when that exact product already has verified nutrition sitting in the
// catalog (common foods, or branded foods already cached from Open Food
// Facts via a barcode scan or search). This substitutes the catalog's own
// numbers in that case, so a repeat photo of a product already in the
// catalog gets real data instead of a fresh visual guess every time.
//
// Exact-name match only, never fuzzy — a wrong substitution here is worse
// than no substitution at all, since it would confidently show
// verified-looking numbers for the wrong product. Only common/branded are
// considered (never "custom": another member's private food isn't a
// trustworthy source to silently apply to someone else's photo scan).
function normalizeForExactMatch(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function matchIdentifiedItemToCatalog<T extends { name: string; source: "label" | "estimate" }>(
  item: T,
  commonFoods: FoodRecord[],
  brandedFoods: FoodRecord[]
): FoodRecord | null {
  if (item.source !== "estimate") return null;
  const target = normalizeForExactMatch(item.name);
  if (!target) return null;

  for (const food of [...commonFoods, ...brandedFoods]) {
    if (food.archivedAt) continue;
    const name = normalizeForExactMatch(food.name);
    const combined = food.brandName ? normalizeForExactMatch(`${food.brandName} ${food.name}`) : name;
    if (name === target || combined === target) return food;
  }
  return null;
}

// Applies matchIdentifiedItemToCatalog across a full identifyFoodPhoto
// result, substituting matched items' serving/macros with the catalog
// record's own default-serving values (a known, real serving — e.g. "1 can
// (330ml)" — rather than trying to reconcile the AI's rough visual gram
// estimate against per-100g catalog data) and relabeling them "label" since
// the numbers are now catalog-verified, not a visual guess.
export function applyCatalogMatches<T extends { name: string; servingDescription: string; calories: number; proteinG: number; carbsG: number; fatG: number; source: "label" | "estimate" }>(
  items: T[],
  commonFoods: FoodRecord[],
  brandedFoods: FoodRecord[]
): T[] {
  return items.map((item) => {
    const match = matchIdentifiedItemToCatalog(item, commonFoods, brandedFoods);
    if (!match) return item;
    const nutrition = nutritionForGrams(match.nutrition100g, match.defaultServing.grams);
    return {
      ...item,
      servingDescription: match.defaultServing.label,
      calories: nutrition.calories,
      proteinG: nutrition.proteinG,
      carbsG: nutrition.carbsG,
      fatG: nutrition.fatG,
      source: "label" as const,
    };
  });
}

// ── Open Food Facts normalization ───────────────────────────────────────
// The ONLY place an OFF payload is read — everything past this function
// deals exclusively in FoodRecord. serving_size is a free-text vendor
// field ("30 g", "1 bar (40g)"); we only trust a leading "<number> g|ml"
// pattern and treat ml ≈ g (fine for the liquids this covers — a stricter
// density-aware conversion isn't worth it for a serving-size hint).
function parseServingGrams(servingSize: string | undefined): number | null {
  if (!servingSize) return null;
  const match = servingSize.match(/([\d.]+)\s*(g|ml)\b/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Open Food Facts country tags are lowercase English country names with a
// language-code prefix (e.g. "en:united-states", "en:ireland") — mapping the
// ones this gym's members are actually likely to have to ISO 3166-1 alpha-2
// lets FoodRecord.region be compared directly against ProfileRecord.country
// (also alpha-2) for the search ranking boost in rankByTextMatch. Keep in
// sync with lib/profile-options.ts's COUNTRY_OPTIONS — every value a member
// can pick there needs a matching entry here or the boost can never fire for
// OFF-sourced foods from that country. An unmapped tag is left as-is
// (harmless: it just never matches a profile's country).
const OFF_COUNTRY_TAG_TO_ALPHA2: Record<string, string> = {
  "en:ireland": "IE",
  "en:united-kingdom": "GB",
  "en:united-states": "US",
  "en:canada": "CA",
  "en:australia": "AU",
  "en:new-zealand": "NZ",
  "en:france": "FR",
  "en:germany": "DE",
  "en:spain": "ES",
  "en:italy": "IT",
  "en:netherlands": "NL",
  "en:belgium": "BE",
  "en:portugal": "PT",
  "en:switzerland": "CH",
  "en:austria": "AT",
  "en:sweden": "SE",
  "en:norway": "NO",
  "en:denmark": "DK",
  "en:finland": "FI",
  "en:poland": "PL",
};

export function normalizeOffCountryTag(tag: string | null | undefined): string | null {
  if (!tag) return null;
  return OFF_COUNTRY_TAG_TO_ALPHA2[tag.toLowerCase()] ?? tag;
}

export function normalizeOpenFoodFactsProduct(product: OpenFoodFactsProduct, barcode: string, id: string, now: string): FoodRecord {
  const n = product.nutriments ?? {};
  const servingGrams = parseServingGrams(product.serving_size);
  const hundredGramServing: FoodServing = { label: "100g", grams: 100 };
  const namedServing: FoodServing | null = servingGrams ? { label: product.serving_size!.trim(), grams: servingGrams } : null;
  const servings = namedServing && namedServing.label !== hundredGramServing.label ? [namedServing, hundredGramServing] : [hundredGramServing];

  return {
    id,
    domain: "branded",
    name: product.product_name?.trim() || "Unknown product",
    brandName: product.brands?.split(",")[0]?.trim() || null,
    barcode,
    imageUrl: product.image_front_small_url || product.image_small_url || product.image_url || null,
    nutrition100g: {
      calories: n["energy-kcal_100g"] ?? 0,
      proteinG: n.proteins_100g ?? 0,
      carbsG: n.carbohydrates_100g ?? 0,
      fatG: n.fat_100g ?? 0,
      fiberG: n.fiber_100g ?? null,
      sugarG: n.sugars_100g ?? null,
      sodiumMg: n.sodium_100g !== undefined ? Math.round(n.sodium_100g * 1000) : null,
      saturatedFatG: n["saturated-fat_100g"] ?? null,
    },
    defaultServing: namedServing ?? hundredGramServing,
    servings,
    provenance: "open_food_facts",
    sourceRef: barcode,
    verified: false,
    region: normalizeOffCountryTag(product.countries_tags?.[0]),
    ownerUserId: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    fetchedAt: now,
  };
}

// ── Custom food input validation ────────────────────────────────────────
export interface ParsedCustomFoodInput {
  name: string;
  brandName: string | null;
  barcode: string | null;
  nutrition100g: FoodNutrition100g;
  servings: FoodServing[];
  defaultServing: FoodServing;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseCustomFoodInput(body: Record<string, unknown>): { ok: true; value: ParsedCustomFoodInput } | { ok: false; message: string } {
  const { name, brandName, barcode, nutrition100g, servings } = body;

  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, message: "Food name is required." };
  }

  let cleanBarcode: string | null = null;
  if (barcode !== undefined && barcode !== null && barcode !== "") {
    if (typeof barcode !== "string" || !isBarcodeShaped(barcode.trim())) {
      return { ok: false, message: "barcode must be a UPC/EAN/GTIN digit string (8, 12, 13, or 14 digits)." };
    }
    cleanBarcode = barcode.trim();
  }

  const n = (nutrition100g ?? {}) as Record<string, unknown>;
  const calories = nonNegativeNumber(n.calories);
  const proteinG = nonNegativeNumber(n.proteinG);
  const carbsG = nonNegativeNumber(n.carbsG);
  const fatG = nonNegativeNumber(n.fatG);
  if (calories === null || proteinG === null || carbsG === null || fatG === null) {
    return { ok: false, message: "nutrition100g.calories/proteinG/carbsG/fatG must be non-negative numbers." };
  }

  const parsedServings: FoodServing[] = Array.isArray(servings)
    ? servings.flatMap((raw) => {
        const rec = (raw ?? {}) as Record<string, unknown>;
        const label = typeof rec.label === "string" && rec.label.trim() ? rec.label.trim().slice(0, 60) : null;
        const grams = nonNegativeNumber(rec.grams);
        return label && grams !== null && grams > 0 ? [{ label, grams }] : [];
      })
    : [];

  const hundredGram: FoodServing = { label: "100g", grams: 100 };
  const finalServings = parsedServings.some((s) => s.label === hundredGram.label) ? parsedServings : [...parsedServings, hundredGram];

  return {
    ok: true,
    value: {
      name: name.trim().slice(0, 120),
      brandName: typeof brandName === "string" && brandName.trim() ? brandName.trim().slice(0, 80) : null,
      barcode: cleanBarcode,
      nutrition100g: {
        calories,
        proteinG,
        carbsG,
        fatG,
        fiberG: nonNegativeNumber(n.fiberG),
        sugarG: nonNegativeNumber(n.sugarG),
        sodiumMg: nonNegativeNumber(n.sodiumMg),
        saturatedFatG: nonNegativeNumber(n.saturatedFatG),
      },
      servings: finalServings,
      defaultServing: finalServings[0],
    },
  };
}

// Branded-cache staleness — a cached OFF record older than this is eligible
// for the refresh job (scripts/refresh-branded-cache.mjs), not for eviction:
// stale-but-present data still beats no data for the barcode/search paths.
export const BRANDED_CACHE_STALE_DAYS = 30;

export function isBrandedRecordStale(food: FoodRecord, now: Date = new Date()): boolean {
  if (!food.fetchedAt) return true;
  const ageMs = now.getTime() - new Date(food.fetchedAt).getTime();
  return ageMs > BRANDED_CACHE_STALE_DAYS * 24 * 60 * 60 * 1000;
}
