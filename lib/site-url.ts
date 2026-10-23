import { getConfiguredAppUrl } from "@/lib/app-config";

// The public origin used for canonical URLs, the sitemap, robots.txt and
// social previews. Comes from APP_URL (or appUrl in SANDC_APP_CONFIG); falls
// back to the business domain so a missing or malformed value can never break
// the build. Always an origin with no trailing slash, e.g.
// "https://sandccoaching.com".
export const FALLBACK_SITE_URL = "https://sandccoaching.com";

export function getSiteUrl(): string {
  const configured = getConfiguredAppUrl();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      console.warn(`[site-url] APP_URL "${configured}" is not a valid URL; using ${FALLBACK_SITE_URL}`);
    }
  }
  return FALLBACK_SITE_URL;
}

// Search indexing switch for non-production deployments: SEARCH_INDEXING=off
// makes robots.txt disallow everything (a staging copy must never be indexed).
export function isSearchIndexingEnabled(): boolean {
  return process.env.SEARCH_INDEXING?.trim().toLowerCase() !== "off";
}
