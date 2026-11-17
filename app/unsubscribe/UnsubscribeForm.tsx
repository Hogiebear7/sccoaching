"use client";

import { useState } from "react";

// One button, so opening the link never unsubscribes anyone by accident. Emails about bookings, billing and your account are not affected.
export function UnsubscribeForm({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");

  async function go() {
    setState("working");
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: token }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (!token) return <p className="text-sm text-muted-foreground">This link is missing its code. Use the link in the email you received.</p>;
  if (state === "done")
    return (
      <p className="text-sm">
        You&apos;re unsubscribed. You&apos;ll still get emails about your bookings, payments and account. You can change your choices any time in Settings.
      </p>
    );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Stop these emails? Emails about your bookings, payments and account will still reach you.
      </p>
      {state === "error" ? <p className="text-sm text-destructive">That link isn&apos;t valid any more. You can change your choices in Settings.</p> : null}
      <button
        type="button"
        onClick={go}
        disabled={state === "working"}
        className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {state === "working" ? "Working…" : "Unsubscribe"}
      </button>
    </div>
  );
}
