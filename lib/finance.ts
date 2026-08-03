// Revenue aggregation for the staff Finances tab (admin_manager only — see
// lib/permissions.ts "finance.view"). Merges the two sources of real payment
// data this app has: RevenueEventRecord (membership renewals, recorded by
// the Stripe/Revolut webhooks) and paid PurchaseRecord rows (one-time class
// passes/top-ups). Deliberately does NOT compute anything beyond gross
// revenue — there is no expense tracking anywhere in this app, so a true
// profit/tax-liability figure is not something this data can support.
//
// SERVER-ONLY: this imports lib/db.ts (Node's `fs`). Pure helpers that don't
// touch the datastore — grouping, range math, age brackets — live in
// lib/finance-shared.ts instead, which is safe to import from client
// components. Only import this file from server components/routes.

import { findAllPurchases, findAllRevenueEvents, findMembershipPackageById, findProfileByUserId } from "@/lib/db";
import { ageBracketForAge, ageFromDateOfBirth, type RevenueLine } from "@/lib/finance-shared";

export * from "@/lib/finance-shared";

function ageBracketForUser(userId: string) {
  const profile = findProfileByUserId(userId);
  return ageBracketForAge(ageFromDateOfBirth(profile?.dateOfBirth ?? null));
}

// Every revenue-bearing record this app has, in one shape. Read-heavy and
// small in volume (file-backed store), so callers filter/group in memory
// rather than this module taking range params — see FinancesView.tsx.
export function buildRevenueLines(): RevenueLine[] {
  const renewals: RevenueLine[] = findAllRevenueEvents().map((e) => ({
    id: e.id,
    userId: e.userId,
    amountCents: e.amountCents,
    currency: e.currency,
    provider: e.provider,
    kind: "membership_renewal",
    packageName: e.packageId ? (findMembershipPackageById(e.packageId)?.name ?? null) : null,
    ageBracket: ageBracketForUser(e.userId),
    occurredAt: e.receivedAt,
  }));

  const passPurchases: RevenueLine[] = findAllPurchases()
    .filter((p) => p.kind === "pass_pack" && p.status === "paid")
    .map((p) => ({
      id: p.id,
      userId: p.userId,
      amountCents: p.amountCents,
      // PurchaseRecord has no currency field of its own — the app is EUR-only
      // throughout its catalog/billing-option pricing, so this matches that
      // existing assumption rather than inventing a new one.
      currency: "eur",
      provider: p.provider,
      kind: "pass_pack",
      packageName: findMembershipPackageById(p.productId)?.name ?? p.description,
      ageBracket: ageBracketForUser(p.userId),
      occurredAt: p.updatedAt,
    }));

  return [...renewals, ...passPurchases].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}
