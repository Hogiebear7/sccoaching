"use client";

import { useState } from "react";

import { effectivePrefs, type EmailPrefs } from "@/lib/comms-prefs";

// The two optional email topics: getting-started tips and news and offers. Emails about bookings, payments and your account are separate and aren't
// affected. News and offers are off until you switch them on.
export function OptionalEmailCard({ initial }: { initial: Partial<EmailPrefs> | null | undefined }) {
  const start = effectivePrefs(initial);
  const [tips, setTips] = useState(start.tips);
  const [marketing, setMarketing] = useState(start.marketing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(patch: { tips?: boolean; marketing?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/email-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, source: "settings-web" }),
      });
      if (!res.ok) throw new Error("Couldn't save. Please try again.");
      if (patch.tips !== undefined) setTips(patch.tips);
      if (patch.marketing !== undefined) setMarketing(patch.marketing);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const row = (label: string, hint: string, on: boolean, onClick: () => void) => (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={busy}
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/[0.09] bg-white/[0.03] px-4 py-3 text-left transition disabled:opacity-60"
    >
      <span>
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-zinc-500">{hint}</span>
      </span>
      <span className={["relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors", on ? "border-primary bg-primary" : "border-border bg-muted"].join(" ")}>
        <span className={["inline-block h-3 w-3 rounded-full bg-white shadow transition-transform", on ? "translate-x-4" : "translate-x-0.5"].join(" ")} />
      </span>
    </button>
  );

  return (
    <div className="surface-card p-5">
      <p className="mb-1 text-sm font-medium text-zinc-100">Tips and news by email</p>
      <p className="mb-4 text-xs text-zinc-500">Optional. Emails about your bookings, payments and account always reach you.</p>
      {error ? <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
      <div className="space-y-2">
        {row("Getting-started tips", "A few short emails after you join.", tips, () => change({ tips: !tips }))}
        {row("News and offers", "Newsletters and promotions from S&C Performance Coaching.", marketing, () => change({ marketing: !marketing }))}
      </div>
    </div>
  );
}
