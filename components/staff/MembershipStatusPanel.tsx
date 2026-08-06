"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { isPendingCheckoutStale } from "@/lib/billing";
import { describePackageAllowance } from "@/lib/catalog";
import type { BillingProvider, MembershipPackageRecord, PassLedgerEntryRecord, SubscriptionStatus } from "@/lib/db";
import {
  formatMembershipDate,
  isPeriodLapsed,
  SUBSCRIPTION_STATUS_LABEL,
  SUBSCRIPTION_STATUS_STYLE,
} from "@/lib/membership-status";
import { formatRemainingSessions, type ClassPassBalance } from "@/lib/scheduling-status";

const STATUS_OPTIONS: SubscriptionStatus[] = [
  "inactive",
  "pending",
  "active",
  "past_due",
  "canceled",
];

const PAUSE_DURATION_LABEL: Record<string, string> = {
  "2w": "2 weeks",
  "1m": "1 month",
  "6m": "6 months",
};

export function MembershipStatusPanel({
  memberId,
  packages,
  currentPackageId,
  currentPlanName,
  currentStatus,
  currentProvider,
  currentUpdatedAt,
  currentPeriodEnd,
  currentPausedUntil,
  passBalance,
  purchasedPasses,
  passLedger,
}: {
  memberId: string;
  packages: MembershipPackageRecord[];
  currentPackageId: string | null;
  currentPlanName: string | null;
  currentStatus: SubscriptionStatus | null;
  currentProvider: BillingProvider | null;
  currentUpdatedAt: string | null;
  passBalance: ClassPassBalance | null;
  currentPeriodEnd: string | null;
  /** Only meaningful while currentStatus is "paused". */
  currentPausedUntil: string | null;
  purchasedPasses: number;
  /** Most recent pass-ledger entries (already limited server-side). */
  passLedger: PassLedgerEntryRecord[];
}) {
  const pendingIsStale =
    currentStatus === "pending" && currentUpdatedAt !== null && isPendingCheckoutStale(currentUpdatedAt);
  const periodLapsed =
    currentStatus !== null && isPeriodLapsed({ status: currentStatus, currentPeriodEnd });
  const router = useRouter();
  // Only seed from the member's current package when it's actually in the
  // selectable list (a hidden package isn't) — otherwise the select would
  // display one while submitting another.
  const [packageId, setPackageId] = useState(
    currentPackageId && packages.some((p) => p.id === currentPackageId)
      ? currentPackageId
      : packages[0]?.id ?? ""
  );
  const [status, setStatus] = useState<SubscriptionStatus>(
    currentStatus && currentStatus !== "paused" ? currentStatus : "inactive"
  );
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pauseDuration, setPauseDuration] = useState<"2w" | "1m" | "6m">("1m");
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [pauseMessage, setPauseMessage] = useState<string | null>(null);
  const [isPausing, setIsPausing] = useState(false);
  const [grantAmount, setGrantAmount] = useState("1");
  const [grantNote, setGrantNote] = useState("");
  const [grantError, setGrantError] = useState<string | null>(null);
  const [grantSuccess, setGrantSuccess] = useState<string | null>(null);
  const [isGranting, setIsGranting] = useState(false);

  async function handleGrant(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const amount = Number(grantAmount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 20) {
      setGrantError("Enter a whole number of classes between 1 and 20.");
      return;
    }

    setGrantError(null);
    setGrantSuccess(null);
    setIsGranting(true);

    try {
      const res = await fetch(`/api/staff/members/${memberId}/extra-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, note: grantNote.trim() || undefined }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setGrantError(data?.message ?? "Could not add extra classes. Please try again.");
        return;
      }

      setGrantSuccess(data?.message ?? "Extra classes added.");
      setGrantAmount("1");
      setGrantNote("");
      router.refresh();
    } catch {
      setGrantError("Something went wrong. Please try again.");
    } finally {
      setIsGranting(false);
    }
  }

  async function handlePauseAction(action: "pause" | "resume") {
    setPauseError(null);
    setPauseMessage(null);
    setIsPausing(true);

    try {
      const res = await fetch(`/api/staff/members/${memberId}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "pause" ? { action, duration: pauseDuration } : { action }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setPauseError(data?.message ?? "Could not update the pause. Please try again.");
        return;
      }

      setPauseMessage(data?.message ?? (action === "pause" ? "Membership paused." : "Membership resumed."));
      router.refresh();
    } catch {
      setPauseError("Something went wrong. Please try again.");
    } finally {
      setIsPausing(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!packageId) {
      setError("Select a package first.");
      return;
    }

    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/staff/members/${memberId}/subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId, status }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.message ?? "Could not update membership. Please try again.");
        return;
      }

      setSuccessMessage(data?.message ?? "Membership updated.");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="panel p-6">
      <h3 className="text-lg font-semibold">Membership</h3>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-sm text-foreground">
          {currentPlanName ?? "No package selected"}
        </span>
        {currentStatus ? (
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              periodLapsed ? "bg-destructive/15 text-destructive" : SUBSCRIPTION_STATUS_STYLE[currentStatus]
            }`}
          >
            {periodLapsed
              ? "Period ended"
              : pendingIsStale
                ? "Checkout expired"
                : SUBSCRIPTION_STATUS_LABEL[currentStatus]}
          </span>
        ) : null}
        {currentStatus === "active" && !periodLapsed && passBalance ? (
          <span className="text-xs text-muted-foreground">
            {formatRemainingSessions(passBalance.remaining)}
          </span>
        ) : null}
        {pendingIsStale ? (
          <span className="text-xs text-muted-foreground">
            Member can retry checkout themselves — no action needed.
          </span>
        ) : null}
        {periodLapsed ? (
          <span className="text-xs text-muted-foreground">
            Billing period ended {currentPeriodEnd ? formatMembershipDate(currentPeriodEnd) : ""}
            {currentProvider === "stripe"
              ? " — renewal is automatic, so the last payment hasn't come through. The member can retry checkout, or set status manually below."
              : " — this membership doesn't renew automatically. Member can renew themselves, or set status below."}
          </span>
        ) : null}
        {currentProvider === "revolut" || currentProvider === "stripe" ? (
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            Billed via {currentProvider === "stripe" ? "Stripe" : "Revolut"}
          </span>
        ) : null}
      </div>

      {/* Pause / resume — distinct from the manual override below: it keeps
          the member's real plan and provider intact, just blocks booking and
          benefits (and Stripe billing, when live) for a fixed window. */}
      {currentStatus === "paused" ? (
        <div className="mt-4 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3">
          <p className="text-sm text-sky-300">
            Paused until {currentPausedUntil ? formatMembershipDate(currentPausedUntil) : "—"}. The
            member can&apos;t book classes or use in-app benefits until then.
          </p>
          {pauseError ? (
            <p className="mt-2 text-xs text-destructive">{pauseError}</p>
          ) : null}
          {pauseMessage ? (
            <p className="mt-2 text-xs text-sky-300">{pauseMessage}</p>
          ) : null}
          <button
            type="button"
            onClick={() => handlePauseAction("resume")}
            disabled={isPausing}
            className="mt-3 rounded-xl border border-sky-500/40 px-3 py-1.5 text-xs font-medium text-sky-300 transition hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPausing ? "Resuming…" : "Resume now"}
          </button>
        </div>
      ) : currentStatus === "active" || currentStatus === "past_due" ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-white/[0.02] px-4 py-3">
          <p className="mr-auto text-xs text-muted-foreground">
            Pause this membership — no bookings or benefits, no billing, until it resumes.
          </p>
          <select
            value={pauseDuration}
            onChange={(e) => setPauseDuration(e.target.value as "2w" | "1m" | "6m")}
            aria-label="Pause duration"
            className="input-field px-2 py-1.5 text-xs"
          >
            {(Object.keys(PAUSE_DURATION_LABEL) as ("2w" | "1m" | "6m")[]).map((key) => (
              <option key={key} value={key}>
                {PAUSE_DURATION_LABEL[key]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => handlePauseAction("pause")}
            disabled={isPausing}
            className="rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPausing ? "Pausing…" : "Pause membership"}
          </button>
          {pauseError ? (
            <p className="w-full text-xs text-destructive">{pauseError}</p>
          ) : null}
        </div>
      ) : null}

      {packages.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No packages exist yet — create one in the Catalog first.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Manual override (cash payment, comp, or correcting a stuck state). This
            doesn&apos;t affect any in-progress online checkout.
          </p>

          {error ? (
            <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          {successMessage ? (
            <p className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
              {successMessage}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            {/* Package select takes the main width; the status control stays
                compact so the package name is easy to read. */}
            <select
              value={packageId}
              onChange={(e) => setPackageId(e.target.value)}
              className="w-full flex-1 input-field px-3 py-2"
            >
              {packages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.name} — {describePackageAllowance(pkg)}
                </option>
              ))}
            </select>

            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}
              aria-label="Membership status"
              className="w-full input-field px-2 py-2 sm:w-32 sm:shrink-0"
            >
              {STATUS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {SUBSCRIPTION_STATUS_LABEL[value]}
                </option>
              ))}
            </select>

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Saving…" : "Update"}
            </button>
          </div>
        </form>
      )}

      {/* Class passes this period */}
      {passBalance ? (
        <div className="mt-6 border-t border-white/[0.06] pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold">Class passes this period</h4>
            {passBalance.allowance === null ? (
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                Unlimited plan
              </span>
            ) : (
              <p className="text-xs text-muted-foreground tabular-nums">
                {passBalance.allowance} included · {passBalance.used} used
                {passBalance.extra > 0 ? (
                  <> · <span className="text-gold">{passBalance.extra} extra</span></>
                ) : null}{" "}
                · <span className="font-semibold text-foreground">{passBalance.remaining} remaining</span>
              </p>
            )}
          </div>

          {passBalance.overusedBy > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Used {passBalance.overusedBy} more than the current entitlement — adding extra
              classes below brings the balance back up.
            </p>
          ) : null}

          {passBalance.allowance !== null ? (
            <form onSubmit={handleGrant} className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Add extra classes onto this period&apos;s balance (goodwill, catch-up, promo, or a
                correction). Cleared when a new billing period starts.
              </p>

              {grantError ? (
                <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {grantError}
                </p>
              ) : null}

              {grantSuccess ? (
                <p className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
                  {grantSuccess}
                </p>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={20}
                  step={1}
                  value={grantAmount}
                  onChange={(e) => setGrantAmount(e.target.value)}
                  aria-label="Number of extra classes"
                  className="w-full input-field px-3 py-2 tabular-nums sm:w-24"
                />
                <input
                  type="text"
                  value={grantNote}
                  onChange={(e) => setGrantNote(e.target.value)}
                  maxLength={200}
                  placeholder="Reason (optional) — e.g. missed class goodwill"
                  aria-label="Reason for extra classes"
                  className="flex-1 rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
                />
                <button
                  type="submit"
                  disabled={isGranting}
                  className="btn-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGranting ? "Adding…" : "Add classes"}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      {/* Purchased pass packs — ledger-backed, separate from the monthly
          allowance and from staff extra grants. */}
      {(purchasedPasses !== 0 || passLedger.length > 0) && (
        <div className="mt-6 border-t border-white/[0.06] pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold">Pass packs</h4>
            <span
              className={`text-sm font-semibold tabular-nums ${purchasedPasses < 0 ? "text-destructive" : ""}`}
            >
              {purchasedPasses} remaining
              {purchasedPasses < 0 ? " (refunded after use)" : ""}
            </span>
          </div>
          {passLedger.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {passLedger.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-baseline justify-between gap-3 text-xs"
                >
                  <span className="text-muted-foreground">
                    {formatMembershipDate(entry.createdAt)} · {PASS_LEDGER_LABEL[entry.reason]}
                    {entry.note ? ` — ${entry.note}` : ""}
                    {entry.reason === "purchase" && entry.expiresAt
                      ? ` · use by ${formatMembershipDate(entry.expiresAt)}`
                      : ""}
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${entry.delta > 0 ? "text-primary" : "text-muted-foreground"}`}
                  >
                    {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PASS_LEDGER_LABEL: Record<PassLedgerEntryRecord["reason"], string> = {
  purchase: "Pack purchased",
  refund_reversal: "Refund",
  consume: "Used on a booking",
  consume_reversal: "Returned (early cancel)",
  staff_adjust: "Staff adjustment",
};
