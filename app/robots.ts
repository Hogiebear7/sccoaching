import type { MetadataRoute } from "next";

import { getSiteUrl, isSearchIndexingEnabled } from "@/lib/site-url";

// Read at request time, so APP_URL and SEARCH_INDEXING set on the host apply
// without a rebuild.
export const dynamic = "force-dynamic";

// Public marketing pages are crawlable; member, staff, API, prototype and
// one-time auth-link routes are not. SEARCH_INDEXING=off (staging) blocks
// everything.
export default function robots(): MetadataRoute.Robots {
  if (!isSearchIndexingEnabled()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard", "/staff", "/app", "/admin", "/admin-mobile", "/invite", "/reset-password", "/verify-email-change"],
    },
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
