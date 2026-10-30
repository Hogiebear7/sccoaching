// Structured data (schema.org JSON-LD) for the public website, so search engines and AI assistants read the gym's facts the same way
// everywhere (docs/website-growth-plan-2026-10.md, item 1). Built only from facts the site already states (lib/content.ts,
// lib/marketing-classes.ts): no street address, opening hours or reviews are invented. Add them here when the owner confirms them, matching
// the Google Business Profile exactly.

import { CONTACT_INFO } from "@/lib/content";
import { MARKETING_CLASSES } from "@/lib/marketing-classes";
import { getSiteUrl } from "@/lib/site-url";

const PRICE_PER: Record<string, string> = { month: "MON", class: "C62" };

export function healthClubJsonLd() {
  const url = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "HealthClub",
    "@id": `${url}/#gym`,
    name: "S&C Performance Coaching",
    url,
    logo: `${url}/brand/website-logo-v2.png`,
    image: `${url}/marketing/training-floor.jpg`,
    description:
      "Small-group strength and conditioning in Navan, Co. Meath: Semi-Private Personal Training, Parent & Baby Classes and Over 50s, coached on the floor and tracked in our app.",
    email: CONTACT_INFO.email,
    telephone: CONTACT_INFO.phoneHref,
    address: { "@type": "PostalAddress", addressLocality: "Navan", addressRegion: "Co. Meath", addressCountry: "IE" },
    areaServed: { "@type": "City", name: "Navan" },
    makesOffer: MARKETING_CLASSES.map((c) => {
      const amount = Number(c.price.from.replace(/[^0-9.]/g, ""));
      return {
        "@type": "Offer",
        name: c.name,
        description: c.tagline,
        url: `${url}/classes#${c.slug}`,
        ...(Number.isFinite(amount) && amount > 0
          ? {
              priceSpecification: {
                "@type": "UnitPriceSpecification",
                price: amount,
                priceCurrency: "EUR",
                ...(PRICE_PER[c.price.per] ? { unitCode: PRICE_PER[c.price.per] } : {}),
                description: `From ${c.price.from} per ${c.price.per}`,
              },
            }
          : {}),
      };
    }),
  };
}

/** JSON for a <script type="application/ld+json">, with "<" escaped so text can never close the script tag. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
