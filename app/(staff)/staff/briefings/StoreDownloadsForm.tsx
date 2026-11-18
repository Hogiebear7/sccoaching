"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// The monthly report's prompt for the Apple and Google download numbers (the stores report these in their own consoles, not to this system). Typed in once a month;
// saving refreshes the page so the report shows them.
export function StoreDownloadsForm({ month, label, appStore, googlePlay }: { month: string; label: string; appStore: number | null; googlePlay: number | null }) {
  const router = useRouter();
  const [apple, setApple] = useState(appStore === null ? "" : String(appStore));
  const [google, setGoogle] = useState(googlePlay === null ? "" : String(googlePlay));
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const toCount = (text: string) => (text.trim() === "" ? null : Number(text));
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/staff/settings/store-downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, appStore: toCount(apple), googlePlay: toCount(google) }),
      });
      const data = await res.json().catch(() => null);
      setStatus({ ok: res.ok, message: data?.message ?? (res.ok ? "Saved." : "Something went wrong.") });
      if (res.ok) router.refresh();
    } catch {
      setStatus({ ok: false, message: "Something went wrong. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  const input = "w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15";
  return (
    <div id="downloads" className="mt-4 rounded-xl border border-border p-4">
      <h4 className="text-sm font-semibold">App downloads for {label}</h4>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        The stores don&apos;t send these to us. Read them from App Store Connect (Analytics) and Google Play Console (Statistics) and type them in once a month.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">
          Apple
          <input className={`${input} mt-1`} inputMode="numeric" value={apple} onChange={(e) => setApple(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 120" />
        </label>
        <label className="text-xs text-muted-foreground">
          Google
          <input className={`${input} mt-1`} inputMode="numeric" value={google} onChange={(e) => setGoogle(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 95" />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60">
          {saving ? "Saving…" : "Save downloads"}
        </button>
        {status ? <span className={`text-xs ${status.ok ? "text-muted-foreground" : "text-destructive"}`}>{status.message}</span> : null}
      </div>
    </div>
  );
}
