"use client";

import { isPendingCheckoutStale } from "@/lib/billing";
import type {
  MembershipBillingOptionRecord,
  MembershipCategoryRecord,
  MembershipPackageRecord,
  SubscriptionStatus,
} from "@/lib/db";
import {
  formatMembershipDate,
  isPeriodLapsed,
  SUBSCRIPTION_STATUS_LABEL,
} from "@/lib/membership-status";
import { type ClassPassBalance } from "@/lib/scheduling-status";
import { CatalogBrowser } from "./CatalogBrowser";

// Active/good-standing reads as success; anything requiring attention reads
// as destructive (unchanged — that mapping was already correct); anything
// else (pending checkout, stale, no plan) stays neutral. Never primary/gold
// — this is a status, not a brand action or a premium moment.
function statusBadgeClass(status: SubscriptionStatus, lapsed: boolean, stale: boolean): string {
  if (lapsed || status === "past_due") return "bg-destructive/10 text-destructive border-destructive/20";
  if (stale) return "bg-muted text-muted-foreground border";
  if (status === "active") return "border-[var(--success)]/25 bg-[var(--success-weak)] text-[var(--success)]";
  return "bg-muted text-muted-foreground border";
}

function statusBadgeLabel(status: SubscriptionStatus, lapsed: boolean, stale: boolean): string {
  if (lapsed) return "Period ended";
  if (stale) return "Checkout expired";
  return SUBSCRIPTION_STATUS_LABEL[status];
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 mt-px">
      <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

// Membership — same IA-first standard as the other completed screens: the
// current plan status and this period's class passes are two facts about
// the same subscription, so they're unified into one hero instead of two
// separate same-weight panels; the catalog stays clearly secondary — it's
// what you reach for occasionally, not what you check daily. Token
// semantics corrected throughout: "active"/"your plan"/"current" now read
// as --success (a genuinely positive state) instead of --primary, and the
// pass-vs-membership distinction moves off the primary/gold pairing that
// collide in this palette onto gold/--data instead (see the palette-
// semantics audit and Notifications/Schedule for the same pattern). All
// checkout, billing, and entitlement logic — including the Stripe checkout
// call in CatalogBrowser — is unchanged.
export function MembershipView({
  categories,
  packages,
  billingOptions,
  currentPackageId,
  currentBillingOptionId,
  currentPlanId,
  currentPlanName,
  subscriptionStatus,
  subscriptionUpdatedAt,
  subscriptionCurrentPeriodEnd,
  passBalance,
  purchasedPasses,
  expiringPasses,
  passCheckoutStatus,
  billingConfigured,
}: {
  categories: MembershipCategoryRecord[];
  packages: MembershipPackageRecord[];
  billingOptions: MembershipBillingOptionRecord[];
  /** Catalog package/option the member is actively on (active + unlapsed);
      null for legacy, lapsed, or non-catalog subscriptions. */
  currentPackageId: string | null;
  currentBillingOptionId: string | null;
  currentPlanId: string | null;
  currentPlanName: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  subscriptionUpdatedAt: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  passBalance: ClassPassBalance | null;
  /** Purchased pass-pack balance from the ledger — separate from the plan's
      monthly allowance and never reset by billing periods. */
  purchasedPasses: number;
  /** Usable purchased passes nearing their use-by date (next 30 days). */
  expiringPasses: { count: number; soonestExpiresAt: string } | null;
  /** Return-from-checkout banner state ("pending" | "cancelled"). */
  passCheckoutStatus: string | null;
  billingConfigured: boolean;
}) {
  const pendingIsStale =
    subscriptionStatus === "pending" &&
    subscriptionUpdatedAt !== null &&
    isPendingCheckoutStale(subscriptionUpdatedAt);

  const periodLapsed =
    subscriptionStatus !== null &&
    isPeriodLapsed({ status: subscriptionStatus, currentPeriodEnd: subscriptionCurrentPeriodEnd });

  const isActiveNotLapsed = subscriptionStatus === "active" && !periodLapsed;

  return (
    <section className="anim-rise space-y-10">
      <div>
        <p className="text-mono text-[11px] uppercase tracking-[0.24em] text-gold">Club</p>
        <h1 className="text-editorial mt-2 text-[32px] leading-[1.05] text-zinc-50 sm:text-[36px]">
          Know exactly what you&rsquo;re paying for.
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Your package controls which sessions you can book.
        </p>
      </div>

      {passCheckoutStatus === "pending" && (
        <p className="rounded-lg border border-[var(--success)]/25 bg-[var(--success-weak)] px-4 py-3 text-sm text-[var(--success)]">
          Payment received — your membership or passes will update within a few seconds, once
          Stripe confirms the payment.
        </p>
      )}
      {passCheckoutStatus === "cancelled" && (
        <p className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-muted-foreground">
          Checkout cancelled — no payment was taken.
        </p>
      )}

      {/* Hero — plan status and this period's passes, unified: they're two
          facts about the same subscription, not two unrelated topics. */}
      <div className="surface-card surface-card--accent overflow-hidden">
        <div className="border-b border-white/[0.06] p-5 sm:p-6">
          {currentPlanId && currentPlanName && subscriptionStatus ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="label-caps">Current membership</p>
                  <p className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">{currentPlanName}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusBadgeClass(subscriptionStatus, periodLapsed, pendingIsStale)}`}>
                  {statusBadgeLabel(subscriptionStatus, periodLapsed, pendingIsStale)}
                </span>
              </div>

              {periodLapsed && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                  <WarningIcon />
                  <span>
                    Your billing period ended on{" "}
                    {subscriptionCurrentPeriodEnd ? formatMembershipDate(subscriptionCurrentPeriodEnd) : "an earlier date"}
                    . Choose an option below to continue.
                  </span>
                </div>
              )}

              {subscriptionStatus === "past_due" && !periodLapsed && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                  <WarningIcon />
                  <span>Your last payment failed. Update your payment method to keep your sessions.</span>
                </div>
              )}

              {isActiveNotLapsed && subscriptionCurrentPeriodEnd && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Billing period ends {formatMembershipDate(subscriptionCurrentPeriodEnd)} · renews automatically.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              You haven&apos;t joined yet. Browse the options below.
            </p>
          )}

          <p className={`text-[11px] text-muted-foreground ${currentPlanId ? "mt-4 border-t border-white/[0.06] pt-4" : "mt-2"}`}>
            {!billingConfigured
              ? "Online payment isn't set up yet — selecting an option records your choice only. Staff can activate your membership manually."
              : "Memberships are recurring subscriptions via our secure Stripe checkout; one-off passes are single payments. Access activates once payment is confirmed."}
          </p>
        </div>

        <div className="p-5 sm:p-6">
          <p className="label-caps">Class passes</p>

          {!isActiveNotLapsed || !passBalance ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {currentPlanId
                ? "Your membership isn't active right now — class passes appear here once it is."
                : "Join below to get class passes."}
            </p>
          ) : passBalance.remaining === null ? (
            <>
              <p className="text-display mt-2 text-[28px] leading-tight text-zinc-50">Unlimited</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Your membership has no monthly class cap — book as often as you like.
              </p>
            </>
          ) : (
            <>
              <p className="text-display mt-2 text-[28px] leading-tight tabular-nums text-zinc-50">
                {passBalance.remaining}
                <span className="ml-2 align-middle text-sm font-normal tracking-normal text-muted-foreground">
                  pass{passBalance.remaining === 1 ? "" : "es"} remaining
                </span>
              </p>
              <p className="mt-2 text-xs text-muted-foreground tabular-nums">
                {passBalance.allowance} included · {passBalance.used} used
                {passBalance.extra > 0 ? (<> · <span className="font-medium text-gold">{passBalance.extra} extra</span></>) : null}
              </p>
              {passBalance.overusedBy > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  You&apos;ve booked {passBalance.overusedBy} more than your current allowance this period — talk to your coach if anything looks off.
                </p>
              ) : null}
              <p className="mt-3 border-t border-white/[0.06] pt-3 text-[11px] text-muted-foreground">
                Passes reset when your billing period renews
                {subscriptionCurrentPeriodEnd ? ` on ${formatMembershipDate(subscriptionCurrentPeriodEnd)}` : ""}.
              </p>
            </>
          )}

          {/* Purchased pass packs — separate pool, doesn't reset */}
          {purchasedPasses > 0 && (
            <div className="mt-3 border-t border-white/[0.06] pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold tracking-tight text-zinc-100">Purchased passes</span>
                <span className="text-display text-[17px] text-gold tabular-nums">
                  {purchasedPasses} pass{purchasedPasses === 1 ? "" : "es"}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Used automatically once your monthly passes run out. They don&apos;t reset with your billing period.
              </p>
              {expiringPasses && (
                <p className="mt-1.5 text-[11px] font-medium text-[var(--warning)]">
                  {expiringPasses.count} pass{expiringPasses.count === 1 ? "" : "es"} must be used by{" "}
                  {formatMembershipDate(expiringPasses.soonestExpiresAt)}.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Catalog — browse categories → packages → billing options. Secondary
          to the hero above: something reached for occasionally, not
          something checked daily. */}
      <div>
        <CatalogBrowser
          categories={categories}
          packages={packages}
          billingOptions={billingOptions}
          currentPackageId={currentPackageId}
          currentBillingOptionId={currentBillingOptionId}
        />
      </div>
    </section>
  );
}
