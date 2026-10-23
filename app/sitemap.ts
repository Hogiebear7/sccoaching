import type { MetadataRoute } from "next";

import { getConfiguredAppUrl } from "@/lib/app-config";

// The public website's pages (see SITE_NAV in lib/site-content.ts).
const PATHS = ["/", "/classes", "/about", "/faq", "/contact", "/privacy", "/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getConfiguredAppUrl() || "https://sandccoaching.com";
  return PATHS.map((path) => ({
    url: `${base}${path === "/" ? "" : path}`,
    changeFrequency: "monthly",
    priority: path === "/" ? 1 : path === "/privacy" || path === "/terms" ? 0.3 : 0.8,
  }));
}
