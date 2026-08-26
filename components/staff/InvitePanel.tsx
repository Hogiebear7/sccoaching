"use client";

import { useState } from "react";
import type { FormEvent } from "react";

type InvitableTier = "app_subscription" | "membership";

const TIER_LABEL: Record<InvitableTier, string> = {
  app_subscription: "App Subscription",
  membership: "Membership",
};

// Staff-facing entry point for granting a tier before someone has an account
// (or without hunting them down in the member list) — sends an email with a
// one-time redemption link (see app/invite/page.tsx). For an existing member
// already in this list, ChangeTierPanel on their detail page is the faster
// path since it applies instantly with no email round-trip.
export function InvitePanel() {
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState<InvitableTier>("app_subscription");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/staff/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), tier }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.message ?? "Could not send invite. Please try again.");
        return;
      }

      setSuccessMessage(data?.message ?? "Invite sent.");
      setEmail("");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="panel p-4">
      <p className="text-sm font-medium">Invite by email</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Sends a one-time link that grants the chosen tier as soon as the recipient signs in (or
        signs up) with that email.
      </p>

      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        {error ? (
          <p className="w-full rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive sm:hidden">
            {error}
          </p>
        ) : null}
        {successMessage ? (
          <p className="w-full rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary sm:hidden">
            {successMessage}
          </p>
        ) : null}

        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="member@example.com"
          aria-label="Invite email"
          className="min-w-[200px] flex-1 input-field px-3 py-2 text-sm"
        />
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value as InvitableTier)}
          aria-label="Invite tier"
          className="input-field px-3 py-2 text-sm sm:w-44"
        >
          {(Object.keys(TIER_LABEL) as InvitableTier[]).map((value) => (
            <option key={value} value={value}>
              {TIER_LABEL[value]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={isSubmitting}
          className="btn-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Sending…" : "Send invite"}
        </button>
      </form>

      {error ? (
        <p className="mt-3 hidden rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive sm:block">
          {error}
        </p>
      ) : null}
      {successMessage ? (
        <p className="mt-3 hidden rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary sm:block">
          {successMessage}
        </p>
      ) : null}
    </div>
  );
}
