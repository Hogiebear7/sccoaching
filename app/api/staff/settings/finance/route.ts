import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getFinanceSettings, saveFinanceSettings } from "@/lib/db";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// Saves the Finances workspace's manually-entered settings: the tax-rate
// estimate, the Stripe-fee estimate formula, and the cash-position anchor.
// None of these are synced/computed values — see lib/db.ts FinanceSettings
// for exactly what each one is and isn't.
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
    taxRatePercent,
    stripeFeePercent,
    stripeFeeFixedCents,
    cashPositionAnchorCents,
    cashPositionAnchorDate,
  } = (body ?? {}) as Record<string, unknown>;

  function validatedPercent(value: unknown, fieldName: string): { ok: true; value: number | null } | { ok: false; message: string } {
    if (value === null || value === undefined) return { ok: true, value: null };
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, message: `${fieldName} must be a number or null.` };
    }
    if (value < 0 || value > 100) {
      return { ok: false, message: `${fieldName} must be between 0 and 100.` };
    }
    return { ok: true, value };
  }

  function validatedCents(value: unknown, fieldName: string): { ok: true; value: number | null } | { ok: false; message: string } {
    if (value === null || value === undefined) return { ok: true, value: null };
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
      return { ok: false, message: `${fieldName} must be a whole number of cents, or null.` };
    }
    return { ok: true, value };
  }

  const taxRate = validatedPercent(taxRatePercent, "taxRatePercent");
  if (!taxRate.ok) return NextResponse.json({ success: false, message: taxRate.message }, { status: 400 });

  const stripeFeePct = validatedPercent(stripeFeePercent, "stripeFeePercent");
  if (!stripeFeePct.ok) return NextResponse.json({ success: false, message: stripeFeePct.message }, { status: 400 });

  const stripeFeeFixed = validatedCents(stripeFeeFixedCents, "stripeFeeFixedCents");
  if (!stripeFeeFixed.ok) return NextResponse.json({ success: false, message: stripeFeeFixed.message }, { status: 400 });

  const anchorCents = validatedCents(cashPositionAnchorCents, "cashPositionAnchorCents");
  if (!anchorCents.ok) return NextResponse.json({ success: false, message: anchorCents.message }, { status: 400 });

  if (cashPositionAnchorDate !== null && cashPositionAnchorDate !== undefined && typeof cashPositionAnchorDate !== "string") {
    return NextResponse.json({ success: false, message: "cashPositionAnchorDate must be a date string or null." }, { status: 400 });
  }
  // An anchor balance needs an anchor date to mean anything, and vice versa.
  const anchorDateValue = typeof cashPositionAnchorDate === "string" && cashPositionAnchorDate ? cashPositionAnchorDate : null;
  if ((anchorCents.value !== null) !== (anchorDateValue !== null)) {
    return NextResponse.json(
      { success: false, message: "Set both a cash-position balance and a date, or clear both." },
      { status: 400 }
    );
  }

  const next = {
    ...getFinanceSettings(),
    taxRatePercent: taxRate.value,
    stripeFeePercent: stripeFeePct.value,
    stripeFeeFixedCents: stripeFeeFixed.value,
    cashPositionAnchorCents: anchorCents.value,
    cashPositionAnchorDate: anchorDateValue,
  };
  saveFinanceSettings(next);

  return NextResponse.json({ success: true, message: "Saved.", settings: next }, { status: 200 });
}
