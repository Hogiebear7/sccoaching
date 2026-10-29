"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { DigitalPlanSummary } from "@/lib/digital-entitlement";
import type { MemberAccess } from "@/lib/member-access";

const SOURCE_LABEL: Record<DigitalPlanSummary["source"], string> = {
  google_play: "Google Play subscription",
  app_store: "App Store subscription",
  staff_grant: "Complimentary (granted by staff)",
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}

function describePlan(plan: DigitalPlanSummary): string {
  const end = formatDate(plan.currentPeriodEnd);
  if (plan.source === "staff_grant") return end ? `Complimentary until ${end}.` : "Complimentary until staff withdraw it.";
  if (plan.status === "in_grace_period") return `Payment is being retried by the store; access continues${end ? ` (paid to ${end})` : ""}.`;
  if (plan.autoRenewing) return `Renews ${end ? `on ${end}` : "automatically"}.`;
  return `Will not renew; access continues${end ? ` until ${end}` : " to the end of the paid period"}.`;
}

// Staff view of the TWO independent things a member can have (owner decision D1): a paid gym Membership, and digital access
// (AI chat, workout generation, food search, ...). A gym Membership does not include digital access. A paid store
// subscription (Google Play / App Store) is shown here but can only be started, changed or cancelled in the store: staff can
// grant or withdraw a COMPLIMENTARY digital grant, which is labelled as complimentary everywhere it appears.
export function ChangeTierPanel({
  memberId,
  access,
  digitalPlan,
}: {
  memberId: string;
  access: MemberAccess;
  digitalPlan: DigitalPlanSummary | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  // Optional, for complimentary digital access only: an end date (the grant runs through that day) and a note for the audit trail.
  const [endsOn, setEndsOn] = useState("");
  const [note, setNote] = useState("");

  const legacyComp = access.digital && !digitalPlan;
  const hasComplimentary = digitalPlan?.source === "staff_grant" || legacyComp;
  const hasPaidStorePlan = !!digitalPlan && digitalPlan.source !== "staff_grant";

  async function send(action: "membership" | "free" | "app_subscription" | "digital_revoke") {
    setError(null);
    setSuccessMessage(null);
    setPending(action);
    try {
      const res = await fetch(`/api/staff/members/${memberId}/tier`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "app_subscription" ? { tier: action, endsOn: endsOn || null, note: note.trim() || null } : { tier: action }
        ),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "Could not update access. Please try again.");
        return;
      }
      setSuccessMessage(data?.message ?? "Access updated.");
      if (action === "app_subscription") {
        setEndsOn("");
        setNote("");
      }
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="panel p-6">
      <h3 className="text-lg font-semibold">Gym membership and digital access</h3>
      <p className="mt-2 text-xs text-muted-foreground">
        These are two separate things. A gym Membership does not include the digital features, and digital access does not include a gym Membership.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <section aria-labelledby="gym-membership-heading" className="rounded-xl border border-white/[0.08] p-4">
          <h4 id="gym-membership-heading" className="text-sm font-semibold">
            Gym membership
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {access.gymMembership ? "Active — classes, passes and coach messaging." : "None."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {!access.gymMembership ? (
              <button
                type="button"
                onClick={() => send("membership")}
                disabled={pending !== null}
                className="btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending === "membership" ? "Saving…" : "Grant gym Membership"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => send("free")}
                disabled={pending !== null}
                className="input-field px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending === "free" ? "Saving…" : "End gym Membership"}
              </button>
            )}
          </div>
        </section>

        <section aria-labelledby="digital-access-heading" className="rounded-xl border border-white/[0.08] p-4">
          <h4 id="digital-access-heading" className="text-sm font-semibold">
            Digital access
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {digitalPlan
              ? `${SOURCE_LABEL[digitalPlan.source]}. ${describePlan(digitalPlan)}`
              : legacyComp
                ? "Complimentary (granted by staff, earlier record)."
                : "None."}
          </p>
          {hasPaidStorePlan ? (
            <p className="mt-2 text-xs text-muted-foreground">
              A paid store subscription can only be cancelled by the member in {digitalPlan?.source === "app_store" ? "the App Store" : "Google Play"}.
              Staff cannot change or refund it here.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {!hasComplimentary ? (
              <div className="flex w-full flex-col gap-2">
                <label className="text-xs text-muted-foreground">
                  End date (optional)
                  <input
                    type="date"
                    value={endsOn}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setEndsOn(e.target.value)}
                    disabled={pending !== null}
                    className="mt-1 block w-full input-field px-3 py-1.5 text-xs"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Note (optional)
                  <input
                    type="text"
                    value={note}
                    maxLength={200}
                    placeholder="e.g. Gym member"
                    onChange={(e) => setNote(e.target.value)}
                    disabled={pending !== null}
                    className="mt-1 block w-full input-field px-3 py-1.5 text-xs"
                  />
                </label>
                <p className="text-xs text-muted-foreground">Leave the end date empty for access until staff withdraw it.</p>
                <div>
                  <button
                    type="button"
                    onClick={() => send("app_subscription")}
                    disabled={pending !== null}
                    className="btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pending === "app_subscription" ? "Saving…" : "Grant complimentary digital access"}
                  </button>
                </div>
              </div>
            ) : digitalPlan?.source === "staff_grant" || legacyComp ? (
              <button
                type="button"
                onClick={() => send("digital_revoke")}
                disabled={pending !== null}
                className="input-field px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending === "digital_revoke" ? "Saving…" : "Withdraw complimentary access"}
              </button>
            ) : null}
          </div>
        </section>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {successMessage ? (
        <p role="status" className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
          {successMessage}
        </p>
      ) : null}
    </div>
  );
}
