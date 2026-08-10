import { findAllFoods, saveFood } from "@/lib/db";
import { isBrandedRecordStale, normalizeOpenFoodFactsProduct } from "@/lib/food-catalog";
import { lookupOpenFoodFactsByBarcode } from "@/lib/open-food-facts-client";
import type { JobDefinition } from "./types";

// Re-fetches aging OFF-sourced branded records so calorie/macro corrections
// upstream eventually reach members without needing a fresh scan. Capped
// per run so this stays a light, frequent job rather than a slow bulk
// re-crawl — admin-curated and already-fresh records are left alone.
const MAX_REFRESHED_PER_RUN = 25;

export const refreshBrandedFoodCacheJob: JobDefinition = {
  name: "refresh-branded-food-cache",
  description: "Re-fetches stale Open Food Facts-sourced branded food records from the live API.",
  async run() {
    const stale = findAllFoods("branded")
      .filter((f) => f.provenance === "open_food_facts" && f.barcode && isBrandedRecordStale(f))
      .slice(0, MAX_REFRESHED_PER_RUN);

    if (stale.length === 0) {
      return "No stale branded food records to refresh.";
    }

    let refreshed = 0;
    let notFound = 0;
    let failed = 0;

    for (const record of stale) {
      const lookup = await lookupOpenFoodFactsByBarcode(record.barcode as string);
      if (lookup.ok) {
        const updated = normalizeOpenFoodFactsProduct(lookup.product, record.barcode as string, record.id, new Date().toISOString());
        saveFood({ ...updated, createdAt: record.createdAt });
        refreshed++;
      } else if (lookup.reason === "not_found") {
        // The product was pulled from OFF — leave the cached copy as-is
        // (still better than nothing) but don't count it as a failure.
        notFound++;
      } else {
        failed++;
      }
    }

    return `Refreshed ${refreshed}/${stale.length} branded records (${notFound} no longer on Open Food Facts, ${failed} lookup failures).`;
  },
};
