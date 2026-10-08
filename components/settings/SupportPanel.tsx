"use client";

import { useState, useSyncExternalStore } from "react";

import { isAndroidUserAgent, playStoreListingUrl } from "@/lib/app-links";
import { buildSupportMailto, copyText } from "@/lib/support-contact";

const ROW_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.05] px-3.5 py-2 text-[13px] font-medium text-zinc-300 transition-colors duration-150 hover:bg-white/[0.08]";

/**
 * Settings -> Help: "Feedback & support" (a mailto to the verified support address, with the address shown and copyable as the fallback
 * for a device with no mail app) and, on Android browsers only, "Rate the app" (a link to the Google Play listing). Renders nothing for
 * a member with no verified support address and no Android browser. No data is sent or stored by this component.
 */
export function SupportPanel({ supportEmail }: { supportEmail: string | null }) {
  const android = useSyncExternalStore(
    () => () => undefined,
    () => isAndroidUserAgent(navigator.userAgent),
    () => false
  );
  if (!supportEmail && !android) return null;
  return (
    <>
      {supportEmail && <SupportRow email={supportEmail} />}
      {android && <RateAppRow />}
    </>
  );
}

export function SupportRow({ email }: { email: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "unavailable">("idle");

  async function handleCopy() {
    setStatus(await copyText(typeof navigator === "undefined" ? null : navigator.clipboard, email));
  }

  return (
    <div className="surface-card mt-3 px-5 py-4" data-testid="support-row">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-100">Feedback &amp; support</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Questions, ideas or something not working? Email us at <span className="break-all text-zinc-300">{email}</span>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={buildSupportMailto(email)} aria-label="Email S&C support" className={ROW_BUTTON}>
            Email us
          </a>
          <button type="button" onClick={handleCopy} className={ROW_BUTTON}>
            Copy address
          </button>
        </div>
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-4 text-xs text-zinc-500">
        {status === "copied" && "Address copied."}
        {status === "unavailable" && `Couldn't copy automatically. Email us at ${email}.`}
      </p>
    </div>
  );
}

export function RateAppRow() {
  return (
    <div className="surface-card mt-3 px-5 py-4" data-testid="rate-row">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-100">Rate the Android app</p>
          <p className="mt-0.5 text-xs text-zinc-500">Enjoying S&amp;C Performance Coaching? You can leave a rating on Google Play.</p>
        </div>
        <a
          href={playStoreListingUrl()}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Rate S&C Performance Coaching on Google Play (opens in a new tab)"
          className={ROW_BUTTON}
        >
          Rate on Google Play
        </a>
      </div>
    </div>
  );
}
