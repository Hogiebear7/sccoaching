"use client";

import { isPendingCheckoutStale } from "@/lib/billing";
import { PageHeader } from "@/components/ui/PageHeader";
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

function statusBadgeClass(status: SubscriptionStatus, lapsed: boolean, stale: boolean): string {
  if (lapsed || status === "past_due") return "bg-destructive/10 text-destructive border-destructive/20";
  if (stale) return "bg-muted text-muted-foreground border";
  if (status === "active") return "bg-primary/10 text-primary border-primary/20";
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

export function MembershipView({
  categories,
  packages,
  billingOptions,
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
    <div className="space-y-8">
      <PageHeader
        eyebrow="Club"
        title="Membership"
        subtitle="Your package controls which sessions you can book."
      />

      {/* Return-from-checkout banner */}
      {passCheckoutStatus === "pending" && (
        <p className="rounded-lg border border-teal-500/25 bg-teal-500/[0.08] px-4 py-3 text-sm text-teal-300">
          Payment received — your membership or passes will update within a few seconds, once
          Stripe confirms the payment.
        </p>
      )}
      {passCheckoutStatus === "cancelled" && (
        <p className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-muted-foreground">
          Checkout cancelled — no payment was taken.
        </p>
      )}

      {/* Current membership card */}
      <div className="panel p-5">
        {currentPlanId && currentPlanName && subscriptionStatus ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="label-caps">Current membership</p>
                <p className="mt-2 text-xl font-semibold tracking-tight">{currentPlanName}</p>
              </div>
              <span className={`shrink-0 text-[11px] rounded-full px-2.5 py-1 font-medium border ${statusBadgeClass(subscriptionStatus, periodLapsed, pendingIsStale)}`}>
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

        <p className={`text-[11px] text-muted-foreground ${currentPlanId ? "mt-4 border-t border-border pt-4" : "mt-2"}`}>
          {!billingConfigured
            ? "Online payment isn’t set up yet — selecting an option records your choice only. Staff can activate your membership manually."
            : "Memberships are recurring subscriptions via our secure Stripe checkout; one-off passes are single payments. Access activates once payment is confirmed."}
        </p>
      </div>

      {/* Class passes this period */}
      <div className="panel p-5">
        <p className="label-caps">Class passes</p>

        {!isActiveNotLapsed || !passBalance ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {currentPlanId
              ? "Your membership isn't active right now — class passes appear here once it is."
              : "Join below to get class passes."}
          </p>
        ) : passBalance.remaining === null ? (
          <>
            <p className="text-display mt-2 text-[28px] leading-tight">Unlimited</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your membership has no monthly class cap — book as often as you like.
            </p>
          </>
        ) : (
          <>
            <p className="text-display mt-2 text-[28px] leading-tight tabular-nums">
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
              <span className="text-sm font-semibold tracking-tight">Purchased passes</span>
              <span className="text-display text-[17px] text-gold tabular-nums">
                {purchasedPasses} pass{purchasedPasses === 1 ? "" : "es"}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Used automatically once your monthly passes run out. They don&apos;t reset with your billing period.
            </p>
            {expiringPasses && (
              <p className="mt-1.5 text-[11px] font-medium text-amber-300">
                {expiringPasses.count} pass{expiringPasses.count === 1 ? "" : "es"} must be used by{" "}
                {formatMembershipDate(expiringPasses.soonestExpiresAt)}.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Catalog: browse categories → packages → billing options */}
      <CatalogBrowser categories={categories} packages={packages} billingOptions={billingOptions} />
    </div>
  );
}
