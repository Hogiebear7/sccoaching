import type { MetadataRoute } from "next";

import { getSiteUrl } from "@/lib/site-url";

// Read at request time, so APP_URL set on the host applies without a rebuild.
export const dynamic = "force-dynamic";

// The public website's indexable pages (see SITE_NAV in lib/site-content.ts).
// Each URL matches the page's canonical exactly (no query strings).
const PATHS = ["/", "/classes", "/about", "/faq", "/contact", "/privacy", "/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  return PATHS.map((path) => ({
    url: `${base}${path}`,
    changeFrequency: "monthly",
    priority: path === "/" ? 1 : path === "/privacy" || path === "/terms" ? 0.3 : 0.8,
  }));
}
