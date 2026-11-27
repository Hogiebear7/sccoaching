"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Shown to the owner of a new gym that has not gone live: how long the saved setup is kept, and a one-time button to keep it three more days.
export function SaveSetupCard({ expiresText, canExtend }: { expiresText: string; canExtend: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function extend() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/gym/draft/extend", { method: "POST" });
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) {
        setError(json?.message ?? "Something went wrong. Please try again.");
        return;
      }
      setMessage(json?.message ?? "Saved.");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
      <p className="text-sm text-amber-50">
        Your setup is saved for <strong>{expiresText}</strong> from your last visit, then it is removed if you have not gone live. Each time you come back, the time starts again. Going live keeps everything for good.
      </p>
      {canExtend ? (
        <button type="button" disabled={busy} onClick={() => void extend()} className="min-h-10 rounded-md border border-amber-300/50 px-4 text-sm font-semibold text-amber-50 hover:bg-amber-300/10 disabled:opacity-60">
          {busy ? "Saving…" : "Save my setup for 3 more days"}
        </button>
      ) : (
        <p className="text-xs text-amber-100/80">You have used your extra days.</p>
      )}
      {message ? <p className="text-sm text-emerald-200">{message}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
