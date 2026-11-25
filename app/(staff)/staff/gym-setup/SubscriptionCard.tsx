"use client";

import { useState } from "react";

// The gym's platform subscription: start paying, or manage the card, invoices and cancellation. Both buttons only send the browser to a page hosted by the payment provider;
// the gym is marked paid when the provider confirms the payment, not by this page.
export function SubscriptionCard({ enabled, hasCustomer, statusLine, justReturned }: { enabled: boolean; hasCustomer: boolean; statusLine: string; justReturned: "success" | "cancelled" | null }) {
  const [busy, setBusy] = useState(false);
  const [billing, setBilling] = useState<"month" | "year">("month");
  const [message, setMessage] = useState<string | null>(
    justReturned === "success" ? "Thank you. Your payment can take a minute to show here." : justReturned === "cancelled" ? "No payment was taken." : null
  );

  async function go(action: "checkout" | "portal") {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/staff/gym/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, interval: billing }) });
      const json = (await res.json()) as { message?: string; data?: { url?: string } };
      if (res.ok && json.data?.url) {
        window.location.href = json.data.url;
        return;
      }
      setMessage(json.message ?? "Could not start that.");
    } catch {
      setMessage("Could not reach the server.");
    }
    setBusy(false);
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-sm text-zinc-300">{statusLine}</p>
      {enabled ? (
        <div className="flex flex-wrap items-center gap-3">
          <span role="group" aria-label="Billing" className="inline-flex overflow-hidden rounded-md border border-white/15 text-sm">
            {(["month", "year"] as const).map((i) => (
              <button key={i} type="button" aria-pressed={billing === i} onClick={() => setBilling(i)} className={`min-h-10 px-3 ${billing === i ? "bg-white/15 font-semibold text-zinc-50" : "text-zinc-300"}`}>
                {i === "month" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </span>
          <button type="button" disabled={busy} onClick={() => void go("checkout")} className="min-h-10 rounded-md bg-white px-4 text-sm font-semibold text-black disabled:opacity-50">
            {busy ? "Opening…" : hasCustomer ? "Pay or renew" : "Subscribe"}
          </button>
          {hasCustomer ? (
            <button type="button" disabled={busy} onClick={() => void go("portal")} className="min-h-10 rounded-md border border-white/15 px-4 text-sm font-medium text-zinc-100 disabled:opacity-50">
              Manage card, invoices or cancel
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-zinc-400">Online payment is not switched on yet. The platform team will send you a payment link.</p>
      )}
      {message ? <p role="status" className="text-xs text-zinc-300">{message}</p> : null}
    </div>
  );
}
