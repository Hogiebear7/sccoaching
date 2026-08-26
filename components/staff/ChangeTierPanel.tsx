"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import type { MemberTier } from "@/lib/member-access";

const TIER_LABEL: Record<MemberTier, string> = {
  free: "Free",
  app_subscription: "App Subscription",
  membership: "Membership",
};

const TIER_DESCRIPTION: Record<MemberTier, string> = {
  free: "Basic manual logging only — no AI features, food search, gym profiles, or notifications.",
  app_subscription: "Full app access except Schedule/next session.",
  membership: "Full access, tied to an ongoing real-world membership.",
};

// The friendlier counterpart to MembershipStatusPanel's raw package+status
// override below — this one lets staff think in the three tiers members
// actually experience (see lib/member-access.ts) rather than picking a
// catalog package. It calls POST .../tier, which resolves the tier to the
// right package internally.
export function ChangeTierPanel({ memberId, currentTier }: { memberId: string; currentTier: MemberTier }) {
  const router = useRouter();
  const [tier, setTier] = useState<MemberTier>(currentTier);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/staff/members/${memberId}/tier`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.message ?? "Could not update tier. Please try again.");
        return;
      }

      setSuccessMessage(data?.message ?? "Tier updated.");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="panel p-6">
      <h3 className="text-lg font-semibold">App tier</h3>
      <p className="mt-2 text-xs text-muted-foreground">
        Current: <span className="font-semibold text-foreground">{TIER_LABEL[currentTier]}</span> —{" "}
        {TIER_DESCRIPTION[currentTier]}
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row">
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

        <select
          value={tier}
          onChange={(e) => setTier(e.target.value as MemberTier)}
          aria-label="App tier"
          className="w-full flex-1 input-field px-3 py-2"
        >
          {(Object.keys(TIER_LABEL) as MemberTier[]).map((value) => (
            <option key={value} value={value}>
              {TIER_LABEL[value]}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={isSubmitting || tier === currentTier}
          className="btn-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : "Update tier"}
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
