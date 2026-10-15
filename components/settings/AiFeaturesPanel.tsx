"use client";

// Settings control for the member's AI data-sharing consent (lib/ai-consent.ts). Turning it off takes effect on the very next request.
import { useState } from "react";

import { useAiConsent } from "@/components/ai/AiConsent";

export function AiFeaturesPanel() {
  const consent = useAiConsent();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: boolean) {
    setBusy(true);
    setError(null);
    const ok = next ? await consent.grant() : await consent.withdraw();
    setBusy(false);
    if (!ok) setError("Could not save your choice. Please try again.");
  }

  const on = consent.state === "granted";
  return (
    <div className="surface-card px-5 py-4" data-testid="ai-features-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-[34rem]">
          <p className="text-sm font-medium text-zinc-100">AI features</p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
            {on
              ? "On. When you use the AI coach, nutrition coach, food photo and receipt scanning, meal suggestions, programme generation or workout reviews, your text, photos and the training, recovery and nutrition data they need are sent to our AI provider (Anthropic) to write the answer."
              : "Off. Nothing is sent to the AI provider. The rest of the app works as normal."}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            Turning this off stops AI requests straight away. Anything already sent is handled under the provider&apos;s terms described in the{" "}
            <a href="/privacy" className="underline">privacy policy</a>; deleting your account removes what this app stored.
          </p>
          {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="AI features"
          disabled={busy || consent.state === "loading"}
          onClick={() => void change(!on)}
          className={`rounded-lg border px-4 py-1.5 text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${
            on ? "border-white/[0.09] bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]" : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
          }`}
        >
          {busy ? "Saving…" : on ? "Turn off" : "Turn on"}
        </button>
      </div>
    </div>
  );
}
