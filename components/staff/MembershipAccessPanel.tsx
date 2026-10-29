"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { isPendingCheckoutStale } from "@/lib/billing";
import { describePackageAllowance } from "@/lib/catalog";
import type { BillingProvider, MembershipPackageRecord, PassLedgerEntryRecord, SubscriptionStatus } from "@/lib/db";
import type { DigitalPlanSummary } from "@/lib/digital-entitlement";
import type { MemberAccess } from "@/lib/member-access";
import {
  formatMembershipDate,
  isPeriodLapsed,
  SUBSCRIPTION_STATUS_LABEL,
  SUBSCRIPTION_STATUS_STYLE,
} from "@/lib/membership-status";
import { formatRemainingSessions, type ClassPassBalance } from "@/lib/scheduling-status";

// One panel for everything a member has on the staff member page (owner request 2026-10-29: it replaced two overlapping panels,
// "Gym membership and digital access" and "Membership"). Top to bottom: a summary line, the gym Membership (grant with a package and
// an optional end date, end, pause), digital access (complimentary grants; a paid store plan is shown but only the member can change it),
// class passes, and an Advanced section holding the manual package + status override.
//
// A gym Membership and digital access stay two separate things (owner decision D1): a gym Membership does not include digital access.
// Granting/ending needs members.grantTier; pause, passes and the override need members.billing (both admin today). Every action uses
// the routes the two old panels used: /tier, /pause, /extra-sessions, /subscription.

const STATUS_OPTIONS: SubscriptionStatus[] = ["inactive", "pending", "active", "past_due", "canceled"];

const PAUSE_DURATION_LABEL: Record<string, string> = {
  "2w": "2 weeks",
  "1m": "1 month",
  "6m": "6 months",
};

const SOURCE_LABEL: Record<DigitalPlanSummary["source"], string> = {
  google_play: "Google Play subscription",
  app_store: "App Store subscription",
  staff_grant: "Complimentary (granted by staff)",
};

const PASS_LEDGER_LABEL: Record<PassLedgerEntryRecord["reason"], string> = {
  purchase: "Pack purchased",
  refund_reversal: "Refund",
  consume: "Used on a booking",
  consume_reversal: "Returned (early cancel)",
  staff_adjust: "Staff adjustment",
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

const smallButton = "rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60";
const fieldLabel = "text-xs text-muted-foreground";
const field = "mt-1 block w-full input-field px-3 py-1.5 text-xs";

function Notice({ tone, children }: { tone: "error" | "ok"; children: ReactNode }) {
  return tone === "error" ? (
    <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      {children}
    </p>
  ) : (
    <p role="status" className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
      {children}
    </p>
  );
}

export function MembershipAccessPanel({
  memberId,
  canGrant,
  canEditBilling,
  access,
  digitalPlan,
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
  /** members.grantTier: grant or end a gym Membership, grant or withdraw complimentary digital access. */
  canGrant: boolean;
  /** members.billing: pause, class passes and the manual override. */
  canEditBilling: boolean;
  access: MemberAccess;
  digitalPlan: DigitalPlanSummary | null;
  packages: MembershipPackageRecord[];
  currentPackageId: string | null;
  currentPlanName: string | null;
  currentStatus: SubscriptionStatus | null;
  currentProvider: BillingProvider | null;
  currentUpdatedAt: string | null;
  currentPeriodEnd: string | null;
  /** Only meaningful while currentStatus is "paused". */
  currentPausedUntil: string | null;
  passBalance: ClassPassBalance | null;
  purchasedPasses: number;
  /** Most recent pass-ledger entries (already limited server-side). */
  passLedger: PassLedgerEntryRecord[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const pendingIsStale = currentStatus === "pending" && currentUpdatedAt !== null && isPendingCheckoutStale(currentUpdatedAt);
  const periodLapsed = currentStatus !== null && isPeriodLapsed({ status: currentStatus, currentPeriodEnd });
  const paused = currentStatus === "paused";

  // Packages a gym Membership can be granted on: never the App Subscription (that is digital access, granted below).
  const gymPackages = packages.filter((p) => p.deliveryChannel !== "app_only");

  const legacyComp = access.digital && !digitalPlan;
  const hasComplimentary = digitalPlan?.source === "staff_grant" || legacyComp;
  const hasPaidStorePlan = !!digitalPlan && digitalPlan.source !== "staff_grant";

  // ── Grant / end (the /tier route) ───────────────────────────────────────────────────────────────────────────
  const [tierPending, setTierPending] = useState<string | null>(null);
  const [tierError, setTierError] = useState<string | null>(null);
  const [tierMessage, setTierMessage] = useState<string | null>(null);
  const [grantPackageId, setGrantPackageId] = useState(
    currentPackageId && gymPackages.some((p) => p.id === currentPackageId) ? currentPackageId : gymPackages[0]?.id ?? ""
  );
  const [gymEndsOn, setGymEndsOn] = useState("");
  const [digitalEndsOn, setDigitalEndsOn] = useState("");
  const [digitalNote, setDigitalNote] = useState("");

  async function sendTier(action: "membership" | "free" | "app_subscription" | "digital_revoke") {
    if (action === "membership" && !grantPackageId) {
      setTierError("Choose a package first.");
      return;
    }
    setTierError(null);
    setTierMessage(null);
    setTierPending(action);
    try {
      const body =
        action === "membership"
          ? { tier: action, packageId: grantPackageId, endsOn: gymEndsOn || null }
          : action === "app_subscription"
            ? { tier: action, endsOn: digitalEndsOn || null, note: digitalNote.trim() || null }
            : { tier: action };
      const res = await fetch(`/api/staff/members/${memberId}/tier`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setTierError(data?.message ?? "Could not update access. Please try again.");
        return;
      }
      setTierMessage(data?.warning ? `${data?.message ?? "Access updated."} ${data.warning}` : data?.message ?? "Access updated.");
      if (action === "membership") setGymEndsOn("");
      if (action === "app_subscription") {
        setDigitalEndsOn("");
        setDigitalNote("");
      }
      router.refresh();
    } catch {
      setTierError("Something went wrong. Please try again.");
    } finally {
      setTierPending(null);
    }
  }

  // ── Pause / resume (the /pause route) ───────────────────────────────────────────────────────────────────────
  const [pauseDuration, setPauseDuration] = useState<"2w" | "1m" | "6m">("1m");
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [pauseMessage, setPauseMessage] = useState<string | null>(null);
  const [isPausing, setIsPausing] = useState(false);

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

  // ── Extra classes (the /extra-sessions route) ───────────────────────────────────────────────────────────────
  const [grantAmount, setGrantAmount] = useState("1");
  const [grantNote, setGrantNote] = useState("");
  const [grantError, setGrantError] = useState<string | null>(null);
  const [grantSuccess, setGrantSuccess] = useState<string | null>(null);
  const [isGranting, setIsGranting] = useState(false);

  async function handleGrantClasses(e: FormEvent<HTMLFormElement>) {
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

  // ── Manual override (the /subscription route) ───────────────────────────────────────────────────────────────
  // Only seed from the member's current package when it's actually in the selectable list (a hidden package isn't), otherwise the
  // select would display one while submitting another.
  const [packageId, setPackageId] = useState(
    currentPackageId && packages.some((p) => p.id === currentPackageId) ? currentPackageId : packages[0]?.id ?? ""
  );
  const [status, setStatus] = useState<SubscriptionStatus>(currentStatus && currentStatus !== "paused" ? currentStatus : "inactive");
  // The selects start from the member's saved Membership and must follow it when it changes (a grant or an end above, then a refresh).
  // Otherwise the status select kept the old value ("Canceled" beside an Active badge) and Update would quietly undo the change.
  // React's "adjust state when a prop changes" pattern: no effect, no extra render pass.
  const [seenSaved, setSeenSaved] = useState({ currentStatus, currentPackageId });
  if (seenSaved.currentStatus !== currentStatus || seenSaved.currentPackageId !== currentPackageId) {
    setSeenSaved({ currentStatus, currentPackageId });
    setStatus(currentStatus && currentStatus !== "paused" ? currentStatus : "inactive");
    if (currentPackageId && packages.some((p) => p.id === currentPackageId)) setPackageId(currentPackageId);
    if (currentPackageId && gymPackages.some((p) => p.id === currentPackageId)) setGrantPackageId(currentPackageId);
  }
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideMessage, setOverrideMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleOverride(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!packageId) {
      setOverrideError("Select a package first.");
      return;
    }
    setOverrideError(null);
    setOverrideMessage(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/staff/members/${memberId}/subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId, status }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setOverrideError(data?.message ?? "Could not update membership. Please try again.");
        return;
      }
      setOverrideMessage(data?.message ?? "Membership updated.");
      router.refresh();
    } catch {
      setOverrideError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const gymEnd = formatDate(currentPeriodEnd);

  return (
    <div className="panel p-6">
      <h3 className="text-lg font-semibold">Membership &amp; access</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        A gym Membership and digital access are two separate things: a gym Membership doesn&apos;t include the digital features, and digital
        access doesn&apos;t include a gym Membership.
      </p>

      {/* Summary */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-foreground">{currentPlanName ?? "No gym Membership"}</span>
        {currentStatus ? (
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              periodLapsed ? "bg-destructive/15 text-destructive" : SUBSCRIPTION_STATUS_STYLE[currentStatus]
            }`}
          >
            {periodLapsed ? "Period ended" : pendingIsStale ? "Checkout expired" : SUBSCRIPTION_STATUS_LABEL[currentStatus]}
          </span>
        ) : null}
        {currentStatus === "active" && !periodLapsed && passBalance ? (
          <span className="text-xs text-muted-foreground">{formatRemainingSessions(passBalance.remaining)}</span>
        ) : null}
        {pendingIsStale ? <span className="text-xs text-muted-foreground">Member can retry checkout themselves — no action needed.</span> : null}
        {periodLapsed ? (
          <span className="text-xs text-muted-foreground">
            Period ended {currentPeriodEnd ? formatMembershipDate(currentPeriodEnd) : ""}
            {currentProvider === "stripe"
              ? " — renewal is automatic, so the last payment hasn't come through. The member can retry checkout, or set status under Advanced."
              : " — this Membership doesn't renew automatically. Grant it again, or set status under Advanced."}
          </span>
        ) : null}
        {currentProvider === "revolut" || currentProvider === "stripe" ? (
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            Billed via {currentProvider === "stripe" ? "Stripe" : "Revolut"}
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {/* Gym membership */}
        <section aria-labelledby="gym-membership-heading" className="rounded-xl border border-white/[0.08] p-4">
          <h4 id="gym-membership-heading" className="text-sm font-semibold">
            Gym membership
          </h4>

          {paused ? (
            <div className="mt-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2">
              <p className="text-xs text-sky-300">
                Paused until {currentPausedUntil ? formatMembershipDate(currentPausedUntil) : "—"}. The member can&apos;t book classes or use
                Membership benefits until then.
              </p>
              {canEditBilling ? (
                <button
                  type="button"
                  onClick={() => handlePauseAction("resume")}
                  disabled={isPausing}
                  className="mt-2 rounded-xl border border-sky-500/40 px-3 py-1.5 text-xs font-medium text-sky-300 transition hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPausing ? "Resuming…" : "Resume now"}
                </button>
              ) : null}
            </div>
          ) : access.gymMembership ? (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                {gymEnd ? `Active until ${gymEnd} — classes, passes and coach messaging.` : "Active — classes, passes and coach messaging."}
              </p>
              {canGrant ? (
                <button type="button" onClick={() => sendTier("free")} disabled={tierPending !== null} className={`mt-3 ${smallButton}`}>
                  {tierPending === "free" ? "Saving…" : "End gym Membership"}
                </button>
              ) : null}
              {canEditBilling && (currentStatus === "active" || currentStatus === "past_due") ? (
                <div className="mt-4 border-t border-white/[0.06] pt-3">
                  <p className={fieldLabel}>Pause — no bookings or benefits, no billing, until it resumes.</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
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
                    <button type="button" onClick={() => handlePauseAction("pause")} disabled={isPausing} className={smallButton}>
                      {isPausing ? "Pausing…" : "Pause membership"}
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : canGrant ? (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">None.</p>
              {gymPackages.length === 0 ? (
                <p className="text-xs text-muted-foreground">No gym packages exist yet — create one in the Catalog first.</p>
              ) : (
                <>
                  <label className={fieldLabel}>
                    Package
                    <select
                      value={grantPackageId}
                      onChange={(e) => setGrantPackageId(e.target.value)}
                      disabled={tierPending !== null}
                      className={field}
                    >
                      {gymPackages.map((pkg) => (
                        <option key={pkg.id} value={pkg.id}>
                          {pkg.name} — {describePackageAllowance(pkg)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={fieldLabel}>
                    End date (optional)
                    <input
                      type="date"
                      value={gymEndsOn}
                      min={today}
                      onChange={(e) => setGymEndsOn(e.target.value)}
                      disabled={tierPending !== null}
                      className={field}
                    />
                  </label>
                  <p className="text-xs text-muted-foreground">Leave it empty for a Membership that runs until staff end it.</p>
                  <div>
                    <button
                      type="button"
                      onClick={() => sendTier("membership")}
                      disabled={tierPending !== null}
                      className="btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {tierPending === "membership" ? "Saving…" : "Grant gym Membership"}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">None.</p>
          )}
          {pauseError ? <p className="mt-2 text-xs text-destructive">{pauseError}</p> : null}
          {pauseMessage ? <p className="mt-2 text-xs text-sky-300">{pauseMessage}</p> : null}
        </section>

        {/* Digital access */}
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
          {canGrant ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {!hasComplimentary ? (
                <div className="flex w-full flex-col gap-2">
                  <label className={fieldLabel}>
                    End date (optional)
                    <input
                      type="date"
                      value={digitalEndsOn}
                      min={today}
                      onChange={(e) => setDigitalEndsOn(e.target.value)}
                      disabled={tierPending !== null}
                      className={field}
                    />
                  </label>
                  <label className={fieldLabel}>
                    Note (optional)
                    <input
                      type="text"
                      value={digitalNote}
                      maxLength={200}
                      placeholder="e.g. Gym member"
                      onChange={(e) => setDigitalNote(e.target.value)}
                      disabled={tierPending !== null}
                      className={field}
                    />
                  </label>
                  <p className="text-xs text-muted-foreground">Leave the end date empty for access until staff withdraw it.</p>
                  <div>
                    <button
                      type="button"
                      onClick={() => sendTier("app_subscription")}
                      disabled={tierPending !== null}
                      className="btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {tierPending === "app_subscription" ? "Saving…" : "Grant complimentary digital access"}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => sendTier("digital_revoke")} disabled={tierPending !== null} className={smallButton}>
                  {tierPending === "digital_revoke" ? "Saving…" : "Withdraw complimentary access"}
                </button>
              )}
            </div>
          ) : null}
        </section>
      </div>

      {tierError ? (
        <div className="mt-3">
          <Notice tone="error">{tierError}</Notice>
        </div>
      ) : null}
      {tierMessage ? (
        <div className="mt-3">
          <Notice tone="ok">{tierMessage}</Notice>
        </div>
      ) : null}

      {/* Class passes this period */}
      {canEditBilling && passBalance ? (
        <div className="mt-6 border-t border-white/[0.06] pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold">Class passes this period</h4>
            {passBalance.allowance === null ? (
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">Unlimited plan</span>
            ) : (
              <p className="text-xs text-muted-foreground tabular-nums">
                {passBalance.allowance} included · {passBalance.used} used
                {passBalance.extra > 0 ? (
                  <>
                    {" "}
                    · <span className="text-gold">{passBalance.extra} extra</span>
                  </>
                ) : null}{" "}
                · <span className="font-semibold text-foreground">{passBalance.remaining} remaining</span>
              </p>
            )}
          </div>

          {passBalance.overusedBy > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Used {passBalance.overusedBy} more than the current entitlement — adding extra classes below brings the balance back up.
            </p>
          ) : null}

          {passBalance.allowance !== null ? (
            <form onSubmit={handleGrantClasses} className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Add extra classes onto this period&apos;s balance (goodwill, catch-up, promo, or a correction). Cleared when a new billing period
                starts.
              </p>
              {grantError ? <Notice tone="error">{grantError}</Notice> : null}
              {grantSuccess ? <Notice tone="ok">{grantSuccess}</Notice> : null}
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
                <button type="submit" disabled={isGranting} className="btn-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-60">
                  {isGranting ? "Adding…" : "Add classes"}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      {/* Purchased pass packs — ledger-backed, separate from the monthly allowance and from staff extra grants. */}
      {canEditBilling && (purchasedPasses !== 0 || passLedger.length > 0) ? (
        <div className="mt-6 border-t border-white/[0.06] pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold">Pass packs</h4>
            <span className={`text-sm font-semibold tabular-nums ${purchasedPasses < 0 ? "text-destructive" : ""}`}>
              {purchasedPasses} remaining
              {purchasedPasses < 0 ? " (refunded after use)" : ""}
            </span>
          </div>
          {passLedger.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {passLedger.map((entry) => (
                <div key={entry.id} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">
                    {formatMembershipDate(entry.createdAt)} · {PASS_LEDGER_LABEL[entry.reason]}
                    {entry.note ? ` — ${entry.note}` : ""}
                    {entry.reason === "purchase" && entry.expiresAt ? ` · use by ${formatMembershipDate(entry.expiresAt)}` : ""}
                  </span>
                  <span className={`font-semibold tabular-nums ${entry.delta > 0 ? "text-primary" : "text-muted-foreground"}`}>
                    {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Advanced: the manual override. Folded away: it is for cash payments and stuck states, not day-to-day changes. */}
      {canEditBilling ? (
        <details className="mt-6 border-t border-white/[0.06] pt-5">
          <summary className="cursor-pointer text-sm font-semibold">Advanced</summary>
          {packages.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No packages exist yet — create one in the Catalog first.</p>
          ) : (
            <form onSubmit={handleOverride} className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Manual override (cash payment, comp, or correcting a stuck state). Sets the package and status directly. This doesn&apos;t affect
                any in-progress online checkout.
              </p>
              {overrideError ? <Notice tone="error">{overrideError}</Notice> : null}
              {overrideMessage ? <Notice tone="ok">{overrideMessage}</Notice> : null}
              <div className="flex flex-col gap-3 sm:flex-row">
                {/* Package select takes the main width; the status control stays compact so the package name is easy to read. */}
                <select value={packageId} onChange={(e) => setPackageId(e.target.value)} aria-label="Package" className="w-full flex-1 input-field px-3 py-2">
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
                <button type="submit" disabled={isSubmitting} className="btn-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-60">
                  {isSubmitting ? "Saving…" : "Update"}
                </button>
              </div>
            </form>
          )}
        </details>
      ) : null}
    </div>
  );
}
