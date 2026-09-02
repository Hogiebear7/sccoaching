"use client";

import { useState } from "react";

import { formatPriceCents } from "@/lib/billing";
import {
  categoryFromPrice,
  describePackageAllowance,
  formatBillingOptionCadence,
  memberBillingHint,
  memberBillingLabel,
} from "@/lib/catalog";
import type {
  MembershipBillingOptionRecord,
  MembershipCategoryRecord,
  MembershipPackageRecord,
} from "@/lib/db";
import { ClassImageSlot } from "@/components/ui/ClassImageSlot";

// Recurring/one-off is a genuine categorical distinction, not an ordinal
// one — and this palette only has two hues (gold, --data) available once
// success/warning/danger are reserved for status. Icon + label carry the
// distinction alongside color rather than color alone, and the same icon
// is used at both the package level ("Membership"/"Pass") and the billing-
// option level ("Recurring"/"One-off") since they're the same concept.
function CommitmentTag({ recurring, label }: { recurring: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        recurring ? "bg-data/15 text-data" : "bg-gold/[0.12] text-gold"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5 shrink-0">
        <path
          d={
            recurring
              ? "M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0114.13-5.36M20 15a9 9 0 01-14.13 5.36"
              : "M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4V8z"
          }
        />
      </svg>
      {label}
    </span>
  );
}

// Member drill-down: category cards ("from €X") → packages → billing options
// → checkout. Recurring options are memberships; one-time options are class
// passes / top-ups. Entitlement comes from the package, price from the
// option. Checkout flow and all business logic below (the /api/membership/
// checkout call, plan-switch detection, entitlement matching) are
// unchanged — this pass only corrects token semantics and adds icon +
// label so the recurring/one-off distinction doesn't rely on color alone.
export function CatalogBrowser({
  categories,
  packages,
  billingOptions,
  currentPackageId,
  currentBillingOptionId,
}: {
  categories: MembershipCategoryRecord[];
  packages: MembershipPackageRecord[];
  billingOptions: MembershipBillingOptionRecord[];
  /** The package/option the member is actively subscribed to (recurring,
      active + unlapsed). Null for legacy/lapsed/non-catalog subscriptions —
      in which case nothing is marked "Your plan". */
  currentPackageId: string | null;
  currentBillingOptionId: string | null;
}) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [packageId, setPackageId] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const category = categories.find((c) => c.id === categoryId) ?? null;
  const pkg = packages.find((p) => p.id === packageId) ?? null;

  async function checkout(optionId: string) {
    setCheckingOut(optionId);
    setError(null);
    try {
      const res = await fetch("/api/membership/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingOptionId: optionId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "Could not start checkout. Please try again.");
        return;
      }
      if (data?.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return; // keep the loading state while the browser navigates
      }
      setError("Checkout could not be started. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setCheckingOut(null);
    }
  }

  if (categories.length === 0) {
    return (
      <div className="empty-state">
        <p className="text-sm font-medium">Nothing available yet</p>
        <p className="mt-1 text-xs text-muted-foreground">Check back soon.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <p className="label-caps">
          {!category ? "Join the club" : !pkg ? category.name : pkg.name}
        </p>
        {category ? (
          <button
            type="button"
            onClick={() => (pkg ? setPackageId(null) : setCategoryId(null))}
            className="text-[11px] font-medium text-primary transition hover:text-[var(--primary-hover)]"
          >
            ← {pkg ? "All packages" : "All categories"}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/* Level 1: categories — high-level offerings. Photo banner + name
          overlay matches the public marketing page's pricing cards
          (components/marketing/ClassPricingShowcase.tsx) — ClassImageSlot
          already falls back to an on-brand placeholder when a category has
          no cover image set yet, so this looks right immediately even
          before staff upload real photos for every category. */}
      {!category ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.map((cat) => {
            const from = categoryFromPrice(cat, packages, billingOptions);
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryId(cat.id)}
                className="surface-card group flex flex-col overflow-hidden p-0 text-left transition hover:border-white/[0.18]"
              >
                <div className="relative">
                  <ClassImageSlot seed={cat.id} imageUrl={cat.imageUrl} alt={cat.imageAlt} className="h-28 w-full" />
                  <h3 className="text-condensed absolute inset-x-4 bottom-2.5 text-lg uppercase leading-none text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.7)]">
                    {cat.name}
                  </h3>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  {cat.description ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">{cat.description}</p>
                  ) : null}
                  <div className="mt-auto flex items-end justify-between gap-2 pt-4">
                    <div>
                      {from !== null ? (
                        <>
                          <span className="block text-[11px] text-muted-foreground">From</span>
                          <span className="text-display text-[22px] leading-none tabular-nums text-zinc-50">
                            {formatPriceCents(from.amountCents)}
                          </span>
                          {from.billingType === "one_time" ? (
                            <span className="ml-1 text-xs text-muted-foreground">one-off</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">Coming soon</span>
                      )}
                    </div>
                    <span className="text-xs font-medium text-primary transition group-hover:translate-x-0.5">
                      View options →
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Level 2: packages in a category — the actual choices */}
      {category && !pkg ? (
        <div className="space-y-3">
          {category.description ? (
            <p className="px-1 text-sm text-muted-foreground">{category.description}</p>
          ) : null}
          {packages
            .filter((p) => p.categoryId === category.id)
            .map((p) => {
              const opts = billingOptions.filter((o) => o.packageId === p.id);
              const hasOptions = opts.length > 0;
              const from = hasOptions ? Math.min(...opts.map((o) => o.amountCents)) : 0;
              const isPass = p.packageType !== "membership";
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPackageId(p.id)}
                  disabled={!hasOptions}
                  className="surface-card flex w-full items-center justify-between gap-3 p-5 text-left transition hover:border-white/[0.18] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-zinc-50">{p.name}</p>
                      <CommitmentTag recurring={!isPass} label={isPass ? "Pass" : "Membership"} />
                      {p.id === currentPackageId ? (
                        <span className="rounded-full border border-[var(--success)]/30 bg-[var(--success-weak)] px-2 py-0.5 text-[10px] font-semibold text-[var(--success)]">
                          Your plan
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{describePackageAllowance(p)}</p>
                  </div>
                  {hasOptions ? (
                    <span className="shrink-0 text-right text-sm">
                      <span className="text-muted-foreground">from </span>
                      <span className="text-display text-[18px] tabular-nums text-zinc-50">{formatPriceCents(from)}</span>
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">Unavailable</span>
                  )}
                </button>
              );
            })}
        </div>
      ) : null}

      {/* Level 3: ways to pay for this package — recurring vs one-off,
          clearly distinguished by icon + label + color, and "your active
          plan" always reads as success, never as the same color as either
          commitment type. */}
      {category && pkg ? (
        <div className="space-y-3">
          <p className="px-1 text-sm text-muted-foreground">
            {pkg.shortDescription ?? describePackageAllowance(pkg)}
            {" — choose how you'd like to pay."}
          </p>
          {billingOptions
            .filter((o) => o.packageId === pkg.id)
            .map((o) => {
              const recurring = o.billingType === "recurring";
              const isCurrent = o.id === currentBillingOptionId;
              // A recurring sibling of the option you're already on is a plan
              // change (e.g. monthly → annual), not a re-buy — allowed.
              const isSwitch = !isCurrent && recurring && pkg.id === currentPackageId;
              return (
                <div
                  key={o.id}
                  className={`surface-card flex items-center justify-between gap-3 p-5 ${
                    isCurrent
                      ? "border-[var(--success)]/40 bg-[var(--success-weak)]"
                      : recurring
                        ? "border-data/25 bg-data/[0.03]"
                        : "border-gold/25 bg-gold/[0.03]"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-zinc-50">
                      {memberBillingLabel(o)}
                      {isCurrent ? (
                        <span className="rounded-full border border-[var(--success)]/40 bg-[var(--success-weak)] px-2 py-0.5 text-[10px] font-semibold text-[var(--success)]">
                          Your plan
                        </span>
                      ) : (
                        <CommitmentTag recurring={recurring} label={recurring ? "Recurring" : "One-off"} />
                      )}
                    </p>
                    <p className="mt-0.5 text-sm tabular-nums text-zinc-200">
                      {formatPriceCents(o.amountCents)}{" "}
                      <span className="text-xs text-muted-foreground">{formatBillingOptionCadence(o)}</span>
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {isCurrent ? "This is your active membership." : memberBillingHint(o)}
                    </p>
                    {isSwitch ? (
                      <p className="mt-1 text-[11px] text-zinc-400">
                        When your payment goes through, this becomes your membership and a new billing
                        period starts. Your current membership stays active until then — and any time
                        left on it isn&apos;t refunded or credited.
                      </p>
                    ) : null}
                  </div>
                  {isCurrent ? (
                    <span className="shrink-0 rounded-full border border-[var(--success)]/40 px-4 py-2 text-sm font-medium text-[var(--success)]">
                      Current
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => checkout(o.id)}
                      disabled={checkingOut !== null}
                      className="btn-primary shrink-0 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {checkingOut === o.id ? "Starting…" : isSwitch ? "Switch" : recurring ? "Join now" : "Buy pass"}
                    </button>
                  )}
                </div>
              );
            })}
        </div>
      ) : null}
    </div>
  );
}
