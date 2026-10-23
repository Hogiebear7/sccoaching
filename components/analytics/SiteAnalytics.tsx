"use client";

import Link from "next/link";
import Script from "next/script";
import { useSyncExternalStore } from "react";

// Google Analytics 4 for the public website only (mounted by MarketingPage and
// the homepage; never on member, staff or auth screens).
//
// OFF unless both build-time variables are set:
//   NEXT_PUBLIC_ANALYTICS_ENABLED=true
//   NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX
// Even then, nothing from Google loads until the visitor accepts analytics
// cookies in the banner below (EU/Irish ePrivacy rules). Declining, or never
// answering, means no script, no cookies and no requests to Google.

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() ?? "";
export const ANALYTICS_ENABLED =
  process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === "true" && /^G-[A-Z0-9]+$/.test(GA_ID);

const CONSENT_KEY = "sandc-analytics-consent";
const CONSENT_EVENT = "sandc-analytics-consent-change";
type Consent = "granted" | "denied" | null;

function readConsent(): Consent {
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

function writeConsent(value: Consent) {
  try {
    if (value) window.localStorage.setItem(CONSENT_KEY, value);
    else window.localStorage.removeItem(CONSENT_KEY);
  } catch {
    // Storage blocked: the choice lasts for this page view only.
  }
  if (value === "denied") {
    // Stop a running tag and remove the cookies it set.
    (window as unknown as Record<string, boolean>)[`ga-disable-${GA_ID}`] = true;
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=")[0].trim();
      if (name === "_ga" || name.startsWith("_ga_")) {
        document.cookie = `${name}=; Max-Age=0; path=/; domain=${window.location.hostname.replace(/^www\./, ".")}`;
        document.cookie = `${name}=; Max-Age=0; path=/`;
      }
    }
  }
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CONSENT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CONSENT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// "pending" on the server and during hydration, so the banner never flashes.
function useConsent(): Consent | "pending" {
  return useSyncExternalStore(subscribe, readConsent, () => "pending");
}

// Records a GA4 event when analytics is running; a no-op otherwise.
export function trackEvent(name: string, params?: Record<string, string>) {
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (ANALYTICS_ENABLED && readConsent() === "granted" && gtag) gtag("event", name, params ?? {});
}

export function SiteAnalytics() {
  const consent = useConsent();
  if (!ANALYTICS_ENABLED || consent === "pending") return null;

  if (consent === "granted") {
    return (
      <>
        <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
        <Script id="ga4-config" strategy="afterInteractive">
          {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config','${GA_ID}',{allow_google_signals:false,allow_ad_personalization_signals:false});`}
        </Script>
      </>
    );
  }

  if (consent === "denied") return null;

  return (
    <div
      role="region"
      aria-label="Cookie choice"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-white/[0.1] bg-[var(--surface-1)] shadow-[0_-20px_50px_-20px_rgba(0,0,0,0.8)]"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm leading-relaxed text-zinc-300">
          We&apos;d like to use analytics cookies to understand how people use this site. They&apos;re only set if you
          accept.{" "}
          <Link href="/privacy" className="font-semibold text-gold underline underline-offset-2 hover:text-[var(--primary-hover)]">
            Privacy Policy
          </Link>
        </p>
        <div className="flex shrink-0 gap-3">
          <button
            type="button"
            onClick={() => writeConsent("denied")}
            className="inline-flex h-11 flex-1 items-center justify-center rounded-[3px] border border-white/[0.16] px-5 text-sm font-medium text-zinc-200 transition-colors duration-150 hover:border-primary/50 hover:text-white sm:flex-none"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => writeConsent("granted")}
            className="inline-flex h-11 flex-1 items-center justify-center rounded-[3px] bg-primary px-5 text-sm font-semibold text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-[var(--primary-hover)] active:translate-y-px sm:flex-none"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

// Footer list item that reopens the choice. Renders nothing while analytics is off.
export function CookieSettingsLink({ className }: { className?: string }) {
  if (!ANALYTICS_ENABLED) return null;
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          writeConsent(null);
          window.scrollTo({ top: document.documentElement.scrollHeight });
        }}
        className={className}
      >
        Cookie settings
      </button>
    </li>
  );
}
