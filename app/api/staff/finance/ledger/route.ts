import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findFinanceLedgerEntryById,
  findMembershipPackageById,
  findUserById,
  saveFinanceLedgerEntry,
  type FinanceEntryKind,
  type FinanceEntryStatus,
  type FinanceExpenseType,
  type FinanceFeeType,
  type FinanceIncomeSource,
  type FinanceIncomeType,
  type FinanceLedgerEntryRecord,
} from "@/lib/db";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// Local literal lists (not imported as values from lib/db.ts) — matches the
// convention in /api/staff/catalog/packages (PACKAGE_TYPES/ALLOWANCE_TYPES):
// route files own their own validation lists rather than importing value
// exports from lib/db.ts, which keeps lib/db.ts's exported values reserved
// for genuinely server-only consumers.
const KINDS: FinanceEntryKind[] = ["income", "expense", "fee"];
const STATUSES: FinanceEntryStatus[] = ["pending", "cleared", "refunded", "disputed", "failed", "estimate"];
const INCOME_SOURCES: FinanceIncomeSource[] = ["stripe", "apple", "google", "revolut", "manual_cash", "other"];
const INCOME_TYPES: FinanceIncomeType[] = ["tier1_membership", "class_pass", "tier2_app_subscription", "misc_income"];
const EXPENSE_TYPES: FinanceExpenseType[] = ["payroll", "contractor", "software", "rent", "utilities", "marketing", "tax", "misc"];
const FEE_TYPES: FinanceFeeType[] = ["stripe_fee", "apple_fee", "google_fee", "tax_withheld", "other_fee"];

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Manual entry for expenses, fees, and any income source with no webhook
// (Apple/Google app-store subscriptions, cash/manual payments, misc
// income). Same id-presence-picks-create-vs-update convention as
// /api/staff/catalog/*.
export async function POST(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "finance.view");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const {
    id,
    kind,
    incomeSource,
    incomeType,
    expenseType,
    feeType,
    status,
    date,
    currency,
    grossAmountCents,
    feeAmountCents,
    memberId,
    packageId,
    relatedEntryId,
    reference,
    notes,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof kind !== "string" || !KINDS.includes(kind as FinanceEntryKind)) {
    return NextResponse.json({ success: false, message: "A valid entry kind is required." }, { status: 400 });
  }
  const entryKind = kind as FinanceEntryKind;

  if (typeof status !== "string" || !STATUSES.includes(status as FinanceEntryStatus)) {
    return NextResponse.json({ success: false, message: "A valid status is required." }, { status: 400 });
  }

  if (typeof date !== "string" || Number.isNaN(new Date(date).getTime())) {
    return NextResponse.json({ success: false, message: "A valid date is required." }, { status: 400 });
  }

  if (typeof grossAmountCents !== "number" || !Number.isFinite(grossAmountCents) || !Number.isInteger(grossAmountCents)) {
    return NextResponse.json({ success: false, message: "Amount must be a whole number of cents." }, { status: 400 });
  }

  let fee = 0;
  if (feeAmountCents !== undefined && feeAmountCents !== null) {
    if (typeof feeAmountCents !== "number" || !Number.isFinite(feeAmountCents) || !Number.isInteger(feeAmountCents) || feeAmountCents < 0) {
      return NextResponse.json({ success: false, message: "Fee must be a non-negative whole number of cents." }, { status: 400 });
    }
    fee = feeAmountCents;
  }

  // Exactly one of incomeSource+incomeType / expenseType / feeType is set,
  // matching `kind`. Everything else is forced null so a row can never carry
  // classification for a kind it isn't.
  let finalIncomeSource: FinanceIncomeSource | null = null;
  let finalIncomeType: FinanceIncomeType | null = null;
  let finalExpenseType: FinanceExpenseType | null = null;
  let finalFeeType: FinanceFeeType | null = null;

  if (entryKind === "income") {
    if (typeof incomeSource !== "string" || !INCOME_SOURCES.includes(incomeSource as FinanceIncomeSource)) {
      return NextResponse.json({ success: false, message: "A valid income source is required." }, { status: 400 });
    }
    if (typeof incomeType !== "string" || !INCOME_TYPES.includes(incomeType as FinanceIncomeType)) {
      return NextResponse.json({ success: false, message: "A valid income type is required." }, { status: 400 });
    }
    finalIncomeSource = incomeSource as FinanceIncomeSource;
    finalIncomeType = incomeType as FinanceIncomeType;
  } else if (entryKind === "expense") {
    if (typeof expenseType !== "string" || !EXPENSE_TYPES.includes(expenseType as FinanceExpenseType)) {
      return NextResponse.json({ success: false, message: "A valid expense type is required." }, { status: 400 });
    }
    finalExpenseType = expenseType as FinanceExpenseType;
  } else {
    if (typeof feeType !== "string" || !FEE_TYPES.includes(feeType as FinanceFeeType)) {
      return NextResponse.json({ success: false, message: "A valid fee type is required." }, { status: 400 });
    }
    finalFeeType = feeType as FinanceFeeType;
  }

  if (typeof memberId === "string" && memberId.trim() && !findUserById(memberId.trim())) {
    return NextResponse.json({ success: false, message: "That member no longer exists." }, { status: 400 });
  }
  if (typeof packageId === "string" && packageId.trim() && !findMembershipPackageById(packageId.trim())) {
    return NextResponse.json({ success: false, message: "That package no longer exists." }, { status: 400 });
  }

  const existing = typeof id === "string" && id.trim() ? findFinanceLedgerEntryById(id.trim()) : undefined;
  if (typeof id === "string" && id.trim() && !existing) {
    return NextResponse.json({ success: false, message: "This entry no longer exists." }, { status: 404 });
  }

  const now = new Date().toISOString();
  const gross = grossAmountCents;
  const net = entryKind === "income" ? gross - fee : gross;

  const entry: FinanceLedgerEntryRecord = {
    id: existing?.id ?? randomUUID(),
    kind: entryKind,
    incomeSource: finalIncomeSource,
    incomeType: finalIncomeType,
    expenseType: finalExpenseType,
    feeType: finalFeeType,
    status: status as FinanceEntryStatus,
    date,
    currency: typeof currency === "string" && currency.trim() ? currency.trim().toLowerCase() : "eur",
    grossAmountCents: gross,
    feeAmountCents: fee,
    netAmountCents: net,
    memberId: optionalString(memberId),
    packageId: optionalString(packageId),
    relatedEntryId: optionalString(relatedEntryId),
    reference: optionalString(reference),
    sourceExternalId: existing?.sourceExternalId ?? null,
    notes: optionalString(notes),
    createdByUserId: existing?.createdByUserId ?? auth.user.id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  saveFinanceLedgerEntry(entry);

  return NextResponse.json(
    { success: true, message: existing ? "Entry updated." : "Entry added." },
    { status: 200 }
  );
}
