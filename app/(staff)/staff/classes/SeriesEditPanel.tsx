"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ClassSeriesRecord } from "@/lib/db";

type Preview = { lines: string[]; willChange: number; blocked: number };

// Change a repeating class for every upcoming session: fill in what should change, see a plain preview, then confirm.
export function SeriesEditPanel({ series, onClose }: { series: ClassSeriesRecord; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(series.title);
  const [startTime, setStartTime] = useState(series.startTime);
  const [durationMins, setDurationMins] = useState(String(series.durationMins));
  const [capacity, setCapacity] = useState(String(series.capacity));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const changes = { title, startTime, durationMins: Number(durationMins), capacity: Number(capacity) };

  async function send(mode: "preview" | "apply") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/classes/series/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: series.id, mode, changes }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.message ?? "Could not check this change.");
        if (mode === "preview") setPreview(null);
        return;
      }
      if (mode === "preview") {
        setPreview(data.data as Preview);
      } else {
        setDone(data.message as string);
        setPreview(null);
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm";

  return (
    <div className="mt-3 w-full space-y-3 rounded-xl border border-border p-4">
      <p className="text-sm font-semibold">Change every upcoming {series.title} session</p>
      <p className="text-xs text-muted-foreground">Change only what you need. Past sessions are never changed. You will see what happens before anything is saved.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium">
          Class name
          <input className={field} value={title} onChange={(e) => { setTitle(e.target.value); setPreview(null); }} />
        </label>
        <label className="text-xs font-medium">
          Start time
          <input className={field} type="time" value={startTime} onChange={(e) => { setStartTime(e.target.value); setPreview(null); }} />
        </label>
        <label className="text-xs font-medium">
          Length (minutes)
          <input className={field} inputMode="numeric" value={durationMins} onChange={(e) => { setDurationMins(e.target.value); setPreview(null); }} />
        </label>
        <label className="text-xs font-medium">
          Spaces
          <input className={field} inputMode="numeric" value={capacity} onChange={(e) => { setCapacity(e.target.value); setPreview(null); }} />
        </label>
      </div>

      {error ? <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      {done ? <p className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">{done}</p> : null}

      {preview ? (
        <div className="well space-y-1 p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What will happen</p>
          {preview.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {preview ? (
          <button type="button" disabled={busy} onClick={() => send("apply")} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {busy ? "Saving..." : "Save these changes"}
          </button>
        ) : done ? null : (
          <button type="button" disabled={busy} onClick={() => send("preview")} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {busy ? "Checking..." : "See what will change"}
          </button>
        )}
        <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm font-medium">
          {done ? "Close" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
