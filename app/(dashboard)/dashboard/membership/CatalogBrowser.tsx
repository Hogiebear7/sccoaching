"use client";

import { useState } from "react";

import { formatPriceCents } from "@/lib/billing";
import {
  categoryFromPriceCents,
  describePackageAllowance,
  formatBillingOptionCadence,
} from "@/lib/catalog";
import type {
  MembershipBillingOptionRecord,
  MembershipCategoryRecord,
  MembershipPackageRecord,
} from "@/lib/db";

// Member drill-down: category cards ("from €X") → packages → billing options
// → checkout. Recurring options are memberships; one-time options are class
// passes / top-ups. Entitlement comes from the package, price from the option.
export function CatalogBrowser({
  categories,
  packages,
  billingOptions,
}: {
  categories: MembershipCategoryRecord[];
  packages: MembershipPackageRecord[];
  billingOptions: MembershipBillingOptionRecord[];
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
      <div className="mb-3 flex items-center gap-2 px-1">
        <p className="label-caps">
          {!category ? "Join the club" : !pkg ? category.name : pkg.name}
        </p>
        {category ? (
          <button
            type="button"
            onClick={() => (pkg ? setPackageId(null) : setCategoryId(null))}
            className="text-[11px] font-medium text-blue-400 transition hover:text-blue-300"
          >
            ← Back
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/* Level 1: categories */}
      {!category ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.map((cat) => {
            const from = categoryFromPriceCents(cat, packages, billingOptions);
            const count = packages.filter((p) => p.categoryId === cat.id).length;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryId(cat.id)}
                className="panel flex flex-col items-start p-5 text-left transition hover:border-primary/40"
              >
                <p className="font-semibold">{cat.name}</p>
                {cat.description ? (
                  <p className="mt-1 text-xs text-muted-foreground">{cat.description}</p>
                ) : null}
                <p className="mt-3 text-sm">
                  {from !== null ? (
                    <>
                      <span className="text-muted-foreground">from </span>
                      <span className="text-display text-[18px] tabular-nums">{formatPriceCents(from)}</span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">Coming soon</span>
                  )}
                  <span className="ml-2 text-xs text-muted-foreground">
                    · {count} option{count === 1 ? "" : "s"}
                  </span>
                </p>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Level 2: packages in a category */}
      {category && !pkg ? (
        <div className="space-y-3">
          {packages
            .filter((p) => p.categoryId === category.id)
            .map((p) => {
              const from = Math.min(
                ...billingOptions.filter((o) => o.packageId === p.id).map((o) => o.amountCents)
              );
              const hasOptions = billingOptions.some((o) => o.packageId === p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPackageId(p.id)}
                  disabled={!hasOptions}
                  className="panel flex w-full items-center justify-between gap-3 p-5 text-left transition hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">{p.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {describePackageAllowance(p)}
                      {p.packageType !== "membership" ? " · pass" : ""}
                    </p>
                  </div>
                  {hasOptions ? (
                    <span className="shrink-0 text-right text-sm">
                      <span className="text-muted-foreground">from </span>
                      <span className="text-display text-[18px] tabular-nums">{formatPriceCents(from)}</span>
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">No options</span>
                  )}
                </button>
              );
            })}
        </div>
      ) : null}

      {/* Level 3: billing options for a package */}
      {category && pkg ? (
        <div className="space-y-3">
          {pkg.shortDescription ? (
            <p className="px-1 text-sm text-muted-foreground">{pkg.shortDescription}</p>
          ) : null}
          {billingOptions
            .filter((o) => o.packageId === pkg.id)
            .map((o) => (
              <div key={o.id} className="panel flex items-center justify-between gap-3 p-5">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {o.name}
                    <span className="ml-2 rounded-full border px-2 py-0.5 text-[10px] font-medium align-middle text-muted-foreground">
                      {o.billingType === "recurring" ? "Recurring" : "One-off"}
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm tabular-nums">
                    {formatPriceCents(o.amountCents)}{" "}
                    <span className="text-xs text-muted-foreground">
                      {formatBillingOptionCadence(o)}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => checkout(o.id)}
                  disabled={checkingOut !== null}
                  className="btn-primary shrink-0 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {checkingOut === o.id
                    ? "Starting…"
                    : o.billingType === "recurring"
                      ? "Subscribe"
                      : "Buy"}
                </button>
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}
