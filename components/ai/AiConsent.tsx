"use client";

// Web side of the member's AI data-sharing consent (see lib/ai-consent.ts). The server refuses every AI request without a current grant; this
// gives the member the informed choice: what is sent, to whom, that declining costs nothing else in the app, and how to withdraw later.
import { useCallback, useEffect, useState } from "react";

export const AI_CONSENT_REQUIRED_CODE = "ai_consent_required";

export type AiConsentState = "loading" | "granted" | "off";

async function postConsent(granted: boolean): Promise<boolean> {
  try {
    const res = await fetch("/api/profile/ai-consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ granted }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Current consent for the signed-in member, with grant / withdraw actions and a way to flip to "off" when the server refuses a request. */
export function useAiConsent() {
  const [state, setState] = useState<AiConsentState>("loading");

  useEffect(() => {
    let live = true;
    fetch("/api/profile/ai-consent")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (live) setState(body?.data?.granted ? "granted" : "off");
      })
      .catch(() => {
        // If the status can't be read, show the choice: nothing is sent until the member confirms it.
        if (live) setState("off");
      });
    return () => {
      live = false;
    };
  }, []);

  const grant = useCallback(async () => {
    const ok = await postConsent(true);
    if (ok) setState("granted");
    return ok;
  }, []);
  const withdraw = useCallback(async () => {
    const ok = await postConsent(false);
    if (ok) setState("off");
    return ok;
  }, []);
  const markOff = useCallback(() => setState("off"), []);

  return { state, grant, withdraw, markOff };
}

export function AiConsentCard({ feature, onGrant }: { feature: string; onGrant: () => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [declined, setDeclined] = useState(false);

  async function allow() {
    setBusy(true);
    setFailed(false);
    const ok = await onGrant();
    setBusy(false);
    if (!ok) setFailed(true);
  }

  return (
    <div className="border-t border-white/[0.06] p-5" data-testid="ai-consent-card">
      <p className="text-sm font-semibold tracking-tight text-zinc-100">Allow AI features?</p>
      <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
        To answer, {feature} sends what you type, any photos you add, and the training, recovery and nutrition data it needs to our AI provider
        (Anthropic). It is used only to write your answer. You can turn this off at any time in Settings, and everything else in the app keeps
        working without it. See the <a href="/privacy" className="underline">privacy policy</a> for details.
      </p>
      {declined ? (
        <p className="mt-3 text-[13px] text-zinc-500">AI features stay off. Nothing is sent. You can turn them on later in Settings.</p>
      ) : null}
      {failed ? <p className="mt-3 text-sm text-destructive">Could not save your choice. Please try again.</p> : null}
      <div className="mt-4 flex flex-wrap gap-2.5">
        <button type="button" onClick={() => void allow()} disabled={busy} className="btn-primary px-4 py-2.5 disabled:opacity-60">
          {busy ? "Saving…" : "Allow AI features"}
        </button>
        <button
          type="button"
          onClick={() => setDeclined(true)}
          disabled={busy}
          className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-zinc-200 hover:bg-white/[0.08]"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
