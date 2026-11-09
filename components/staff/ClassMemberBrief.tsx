"use client";

import { useState } from "react";

// The compact "how is this member doing" brief a coach opens from a class roster. Fetches /api/staff/members/[userId]/brief on first open (nothing is loaded
// for a member nobody asks about). Membership members only: for anyone else the server answers { walled: true } and this says so.
type Brief =
  | { walled: true; message: string }
  | {
      walled: false;
      state: "good" | "take_care" | "caution" | "no_recent_data";
      lines: string[];
      flags: { code: string; severity: "caution" | "note"; text: string }[];
    };

const STATE_LABEL = { good: "In good shape", take_care: "Take care", caution: "Needs attention", no_recent_data: "Nothing logged recently" } as const;
const STATE_STYLE = {
  good: "border-primary/30 bg-primary/10 text-primary",
  take_care: "border-gold/30 bg-gold/10 text-gold",
  caution: "border-destructive/30 bg-destructive/10 text-destructive",
  no_recent_data: "border-border bg-secondary text-muted-foreground",
} as const;

export function ClassMemberBrief({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || brief || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/staff/members/${encodeURIComponent(userId)}/brief`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.data) setError(data?.message ?? "Couldn't load the brief. Please try again.");
      else setBrief(data.data as Brief);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="text-xs font-medium text-gold transition hover:text-gold/80"
      >
        {open ? "Hide brief" : "How are they doing?"}
      </button>

      {open ? (
        <div className="mt-2 rounded-xl border border-border bg-secondary/40 px-3 py-2 text-xs" role="region" aria-label="Member brief">
          {loading ? <p className="text-muted-foreground">Loading…</p> : null}
          {error ? <p className="text-destructive">{error}</p> : null}
          {brief?.walled ? <p className="text-muted-foreground">{brief.message}</p> : null}
          {brief && !brief.walled ? (
            <div className="space-y-2">
              <span className={`inline-block rounded-full border px-2 py-0.5 font-semibold ${STATE_STYLE[brief.state]}`}>{STATE_LABEL[brief.state]}</span>
              {brief.flags.length > 0 ? (
                <ul className="space-y-1">
                  {brief.flags.map((f) => (
                    <li key={f.code} className={f.severity === "caution" ? "font-medium text-destructive" : "text-foreground"}>
                      {f.text}
                    </li>
                  ))}
                </ul>
              ) : null}
              <ul className="space-y-1 text-muted-foreground">
                {brief.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
