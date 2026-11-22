import type { Metadata } from "next";
import Link from "next/link";

import { SiteAnalytics } from "@/components/analytics/SiteAnalytics";
import { STATIC_HAZE } from "@/components/marketing/haze";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/marketing/MarketingPage";
import { SeasonalLogo } from "@/components/seasonal/SeasonalLogo";
import { appStoreListingUrl, playStoreListingUrl, storeListingsLive } from "@/lib/app-links";
import { BRAND_NAME, CONTACT_INFO } from "@/lib/content";

// /links — the page the Instagram bio points to. Deliberately standalone (no site header or footer) and kept out of search results, because
// it exists to be opened from a phone through the bio link. Contact details come from CONTACT_INFO; the Facebook button appears once
// CONTACT_INFO.facebookUrl is filled in; each store badge appears once its listing is live (lib/app-links.ts storeListingsLive).
export const metadata: Metadata = {
  title: `Links — ${BRAND_NAME}`,
  alternates: { canonical: "/links" },
  description: "Enquire, book your first class or download the S&C Performance Coaching app.",
  robots: { index: false, follow: true },
};

const LINK_BUTTON = `${BUTTON_SECONDARY} w-full`;

export default function LinksPage() {
  const live = storeListingsLive();
  const hasBadges = live.appStore || live.googlePlay;
  const facebook = CONTACT_INFO.facebookUrl;

  return (
    <main data-palette="gold" data-theme="navy" className="relative min-h-screen overflow-hidden text-zinc-100">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] [mask-image:linear-gradient(to_bottom,black,transparent_92%)]"
        style={STATIC_HAZE}
      />
      <div className="relative mx-auto flex w-full max-w-md flex-col items-center px-6 pb-16 pt-12 text-center">
        <SeasonalLogo width={200} height={92} className="h-16 w-auto" />
        <h1 className="text-headline mt-8 text-[44px] leading-[0.95] text-zinc-50">
          Strength, <span className="text-gold">coached.</span>
        </h1>
        <p className="mt-4 max-w-[34ch] text-base leading-relaxed text-zinc-300">
          A fully equipped strength studio in {CONTACT_INFO.location}. Small-group, coached training built around you.
        </p>

        <div className="mt-9 flex w-full flex-col gap-3">
          <Link href="/contact" className={`${BUTTON_PRIMARY} w-full`}>
            Enquire or book your first class
          </Link>
          <a href={`mailto:${CONTACT_INFO.email}`} className={LINK_BUTTON}>
            Email us
          </a>
          <a href={`tel:${CONTACT_INFO.phoneHref}`} className={LINK_BUTTON}>
            Call {CONTACT_INFO.phone}
          </a>
          <Link href="/classes" className={LINK_BUTTON}>
            See our classes
          </Link>
        </div>

        <div className="mt-12 w-full border-t border-white/[0.1] pt-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">The app</p>
          <p className="mx-auto mt-3 max-w-[32ch] text-base leading-relaxed text-zinc-300">
            Book classes, log your training and track your progress.
          </p>
          {hasBadges ? (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {live.appStore && (
                <a href={appStoreListingUrl()} rel="noopener" className="inline-block transition-opacity duration-150 hover:opacity-85">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/marketing/badges/app-store-badge.svg" alt="Download on the App Store" height={48} className="block h-12 w-auto" />
                </a>
              )}
              {live.googlePlay && (
                <a href={playStoreListingUrl()} rel="noopener" className="inline-block transition-opacity duration-150 hover:opacity-85">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/marketing/badges/google-play-badge.png" alt="Get it on Google Play" height={48} className="block h-12 w-auto" />
                </a>
              )}
            </div>
          ) : (
            <Link href="/the-app" className={`${LINK_BUTTON} mt-6`}>
              About the app
            </Link>
          )}
        </div>

        <div className="mt-12 flex w-full flex-col gap-3">
          <a href={CONTACT_INFO.instagramUrl} rel="noopener" className={LINK_BUTTON}>
            Instagram {CONTACT_INFO.instagramHandle}
          </a>
          {facebook && (
            <a href={facebook} rel="noopener" className={LINK_BUTTON}>
              Facebook
            </a>
          )}
          <Link href="/" className={LINK_BUTTON}>
            Visit our website
          </Link>
        </div>
      </div>
      <SiteAnalytics />
    </main>
  );
}
