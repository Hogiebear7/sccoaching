import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findMembershipBillingOptionById,
  findMembershipPackageById,
  findUserById,
  saveMembershipBillingOption,
  type BillingType,
  type MembershipBillingOptionRecord,
} from "@/lib/db";
import { verifySession } from "@/lib/session";

const BILLING_TYPES: BillingType[] = ["recurring", "one_time"];

export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user || user.role !== "staff") {
    return NextResponse.json({ success: false, message: "Only staff can manage the catalog." }, { status: user ? 403 : 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const {
    id,
    packageId,
    name,
    billingType,
    intervalUnit,
    intervalCount,
    priceEur,
    currency,
    visible,
    sortOrder,
    stripePriceId,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof packageId !== "string" || !findMembershipPackageById(packageId)) {
    return NextResponse.json({ success: false, message: "A valid package is required." }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ success: false, message: "Option name is required." }, { status: 400 });
  }
  if (typeof billingType !== "string" || !BILLING_TYPES.includes(billingType as BillingType)) {
    return NextResponse.json({ success: false, message: "A valid billing type is required." }, { status: 400 });
  }

  if (typeof priceEur !== "string" || !priceEur.trim() || Number.isNaN(Number(priceEur)) || Number(priceEur) <= 0) {
    return NextResponse.json({ success: false, message: "A price greater than zero is required." }, { status: 400 });
  }

  // Recurring options need a cadence; one-time options carry none.
  let unit: "month" | "year" | null = null;
  let count: number | null = null;
  if (billingType === "recurring") {
    if (intervalUnit !== "month" && intervalUnit !== "year") {
      return NextResponse.json({ success: false, message: "Choose a monthly or yearly interval." }, { status: 400 });
    }
    const c = Number(intervalCount);
    if (!Number.isInteger(c) || c <= 0 || c > 24) {
      return NextResponse.json({ success: false, message: "Interval count must be a whole number between 1 and 24." }, { status: 400 });
    }
    unit = intervalUnit;
    count = c;
  }

  const existing = typeof id === "string" && id.trim() ? findMembershipBillingOptionById(id) : undefined;
  if (typeof id === "string" && id.trim() && !existing) {
    return NextResponse.json({ success: false, message: "This billing option no longer exists." }, { status: 404 });
  }

  const now = new Date().toISOString();
  const option: MembershipBillingOptionRecord = {
    id: existing?.id ?? randomUUID(),
    packageId,
    name: name.trim(),
    billingType: billingType as BillingType,
    intervalUnit: unit,
    intervalCount: count,
    amountCents: Math.round(Number(priceEur) * 100),
    currency: typeof currency === "string" && currency.trim() ? currency.trim().toLowerCase() : existing?.currency ?? "eur",
    visible: typeof visible === "boolean" ? visible : existing?.visible ?? true,
    sortOrder: Number.isFinite(Number(sortOrder)) ? Math.trunc(Number(sortOrder)) : existing?.sortOrder ?? 0,
    stripePriceId: typeof stripePriceId === "string" && stripePriceId.trim() ? stripePriceId.trim() : null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  saveMembershipBillingOption(option);

  return NextResponse.json(
    { success: true, message: existing ? "Billing option updated." : "Billing option created." },
    { status: 200 }
  );
}
