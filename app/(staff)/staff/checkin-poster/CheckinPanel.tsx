"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";

type Mode = "off" | "poster" | "live";

const OPTIONS: { mode: Mode; title: string; body: string }[] = [
  { mode: "off", title: "Off", body: "Members cannot check themselves in. Staff mark who came, as now." },
  { mode: "poster", title: "Poster on the wall", body: "Print one code and put it near the door. Simple. A photo of the poster would work from anywhere, so a member could check in without being there." },
  { mode: "live", title: "Live code on a screen", body: "Show a code on a tablet, TV or phone at the gym. It changes every minute, so a photo is useless a moment later. Best if you want check-ins to be real." },
];

// The gym's check-in choice and the code to show. The code is drawn here in the browser; in live mode it is fetched again every few seconds.
export function CheckinPanel({ initialMode }: { initialMode: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const loadCode = useCallback(async () => {
    try {
      const res = await fetch("/api/staff/checkin-code", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { data?: { code: string | null; secondsLeft?: number } } | null;
      const code = json?.data?.code ?? null;
      if (!res.ok || !code) {
        setSvg(null);
        setSecondsLeft(null);
        return;
      }
      setSvg(await QRCode.toString(code, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#000000", light: "#ffffff" } }));
      setSecondsLeft(json?.data?.secondsLeft ?? null);
    } catch {
      setError("Could not load the code. Check your connection.");
    }
  }, []);

  useEffect(() => {
    if (mode === "off") {
      setSvg(null);
      return undefined;
    }
    void loadCode();
    if (mode !== "live") return undefined;
    const timer = setInterval(() => void loadCode(), 15_000);
    return () => clearInterval(timer);
  }, [mode, loadCode]);

  async function choose(next: Mode) {
    if (next === mode || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/staff/checkin-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: next }) });
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) {
        setError(json?.message ?? "Could not save. Please try again.");
        return;
      }
      setMode(next);
      setMessage(json?.message ?? "Saved.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h2 className="text-display text-[28px] leading-tight">Check-in</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Choose whether members can check themselves in to a class by scanning a code at your gym. Either way, a member can only check in to a class they have booked, from 30 minutes before it starts
          until it ends. The &quot;Scan to check in&quot; button only appears in the app for gyms that turn this on.
        </p>
      </div>

      <div className="grid gap-3 print:hidden" role="radiogroup" aria-label="How members check in">
        {OPTIONS.map((o) => (
          <button
            key={o.mode}
            type="button"
            role="radio"
            aria-checked={mode === o.mode}
            disabled={saving}
            onClick={() => void choose(o.mode)}
            className={`rounded-2xl border p-4 text-left transition ${mode === o.mode ? "border-primary bg-primary/10" : "border-border hover:bg-accent"}`}
          >
            <span className="block text-sm font-semibold">{o.title}</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{o.body}</span>
          </button>
        ))}
      </div>

      {error ? <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive print:hidden">{error}</p> : null}
      {message ? <p className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary print:hidden">{message}</p> : null}

      {mode !== "off" ? (
        <>
          {mode === "poster" ? (
            <div className="print:hidden">
              <button type="button" onClick={() => window.print()} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                Print the poster
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground print:hidden">Keep this page open on a screen at your gym. The code refreshes by itself{secondsLeft ? ` (next change in under ${secondsLeft + 15} seconds)` : ""}.</p>
          )}

          <div className="rounded-2xl bg-white p-8 text-center text-black">
            <p className="text-sm font-semibold uppercase tracking-[0.2em]">Check in here</p>
            <h3 className="mt-2 text-3xl font-bold">Scan to check in to your class</h3>
            {svg ? <div className="mx-auto mt-6 w-full max-w-xs" role="img" aria-label="Check-in code for this gym" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="mt-6 text-sm">Loading the code…</p>}
            <ol className="mx-auto mt-6 max-w-xs list-decimal space-y-1 pl-5 text-left text-base">
              <li>Open the app</li>
              <li>Tap Scan to check in</li>
              <li>Point your phone at this code</li>
            </ol>
            <p className="mt-6 text-xs text-neutral-600">You need to have booked the class first.{mode === "live" ? " This code changes every minute." : ""}</p>
          </div>
        </>
      ) : null}
    </div>
  );
}
