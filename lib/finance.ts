// Business finance ledger aggregation for the staff Finances workspace
// (admin_manager only — see lib/permissions.ts "finance.view"). Merges every
// source of financial data this app has into one FinanceLine[]:
//  - RevenueEventRecord (membership renewals, recorded by the Stripe/Revolut
//    webhooks) — untouched, always income/tier1_membership/cleared.
//  - PurchaseRecord (one-time class passes/top-ups) — untouched, all
//    statuses included so failed/refunded/pending purchases are visible in
//    the ledger, not just paid ones.
//  - FinanceLedgerEntryRecord — the new staff-editable table covering every
//    expense, every fee, and income sources with no webhook (Apple/Google
//    app-store subscriptions, cash/manual payments, misc income).
//
// This used to be framed as "gross revenue only" reporting (see git history
// of this file / the old RevenueLine type) — once Tier 2 app-only income and
// expense tracking exist, that framing no longer fits. This module is the
// finance ledger: income, expenses, and fees side by side, not just what
// Stripe/Revolut happened to charge a member.
//
// SERVER-ONLY: this imports lib/db.ts (Node's `fs`). Pure helpers that don't
// touch the datastore — grouping, range math, forecasting, cash position —
// live in lib/finance-shared.ts instead, which is safe to import from client
// components. Only import this file from server components/routes.

import {
  findAllFinanceLedgerEntries,
  findAllPurchases,
  findAllRevenueEvents,
  findMembershipPackageById,
  findProfileByUserId,
} from "@/lib/db";
import { ageBracketForAge, ageFromDateOfBirth, type AgeBracket, type FinanceLine } from "@/lib/finance-shared";

export * from "@/lib/finance-shared";

function ageBracketForUser(userId: string | null): AgeBracket {
  if (!userId) return "unknown";
  const profile = findProfileByUserId(userId);
  return ageBracketForAge(ageFromDateOfBirth(profile?.dateOfBirth ?? null));
}

// Every financial line this app has, in one shape. Read-heavy and small in
// volume (file-backed store), so callers filter/group in memory rather than
// this module taking range params — see FinancesView.tsx.
export function buildFinanceLedgerLines(): FinanceLine[] {
  const renewals: FinanceLine[] = findAllRevenueEvents().map((e) => ({
    id: e.id,
    kind: "income",
    status: "cleared",
    date: e.receivedAt,
    currency: e.currency,
    grossCents: e.amountCents,
    feeCents: 0,
    netCents: e.amountCents,
    incomeSource: e.provider === "stripe" ? "stripe" : e.provider === "revolut" ? "revolut" : "other",
    incomeType: "tier1_membership",
    expenseType: null,
    feeType: null,
    memberId: e.userId,
    packageName: e.packageId ? (findMembershipPackageById(e.packageId)?.name ?? null) : null,
    reference: e.providerRef,
    notes: null,
    ageBracket: ageBracketForUser(e.userId),
    origin: "revenue_event",
  }));

  // All statuses (not just paid) so failed/refunded/pending pass purchases
  // are visible in the ledger/audit trail — only "cleared" (paid) ones count
  // toward totals, see lib/finance-shared.ts computeTotals.
  const passPurchases: FinanceLine[] = findAllPurchases()
    .filter((p) => p.kind === "pass_pack")
    .map((p) => ({
      id: p.id,
      kind: "income",
      status: p.status === "paid" ? "cleared" : p.status === "refunded" ? "refunded" : p.status === "failed" ? "failed" : p.status === "cancelled" ? "cancelled" : "pending",
      date: p.updatedAt,
      // PurchaseRecord has no currency field of its own — the app is EUR-only
      // throughout its catalog/billing-option pricing, so this matches that
      // existing assumption rather than inventing a new one.
      currency: "eur",
      grossCents: p.amountCents,
      feeCents: 0,
      netCents: p.amountCents,
      incomeSource: p.provider === "stripe" ? "stripe" : p.provider === "revolut" ? "revolut" : "other",
      incomeType: "class_pass",
      expenseType: null,
      feeType: null,
      memberId: p.userId,
      packageName: findMembershipPackageById(p.productId)?.name ?? p.description,
      reference: p.providerPaymentRef ?? p.providerOrderId,
      notes: null,
      ageBracket: ageBracketForUser(p.userId),
      origin: "purchase",
    }));

  const ledgerLines: FinanceLine[] = findAllFinanceLedgerEntries().map((e) => ({
    id: e.id,
    kind: e.kind,
    status: e.status,
    date: e.date,
    currency: e.currency,
    grossCents: e.grossAmountCents,
    feeCents: e.feeAmountCents,
    netCents: e.netAmountCents,
    incomeSource: e.incomeSource,
    incomeType: e.incomeType,
    expenseType: e.expenseType,
    feeType: e.feeType,
    memberId: e.memberId,
    packageName: e.packageId ? (findMembershipPackageById(e.packageId)?.name ?? null) : null,
    reference: e.reference,
    notes: e.notes,
    ageBracket: ageBracketForUser(e.memberId),
    origin: "ledger",
  }));

  return [...renewals, ...passPurchases, ...ledgerLines].sort((a, b) => b.date.localeCompare(a.date));
}
