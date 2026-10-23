import type { MetadataRoute } from "next";

import { getConfiguredAppUrl } from "@/lib/app-config";

// Public marketing pages are crawlable; member, staff, API and prototype
// routes are not.
export default function robots(): MetadataRoute.Robots {
  const base = getConfiguredAppUrl() || "https://sandccoaching.com";
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard", "/staff", "/app", "/admin", "/admin-mobile", "/invite", "/reset-password", "/verify-email-change"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
