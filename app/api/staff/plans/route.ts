import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findClassCategories,
  findMembershipPlanById,
  findUserById,
  saveMembershipPlan,
  type BillingInterval,
  type ClassCategory,
  type MembershipPlanRecord,
} from "@/lib/db";
import { verifySession } from "@/lib/session";

const BILLING_INTERVALS: BillingInterval[] = ["monthly", "annual"];

function parseSessionAllowance(
  value: unknown
): { ok: true; value: number | null } | { ok: false } {
  if (value === "unlimited") return { ok: true, value: null };
  if (typeof value !== "string" || !value.trim()) return { ok: false };

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return { ok: false };

  return { ok: true, value: parsed };
}

function parseAllowedCategories(value: unknown): { ok: true; value: ClassCategory[] } | { ok: false } {
  if (!Array.isArray(value) || value.length === 0) return { ok: false };
  const activeSlugs = findClassCategories().map((c) => c.slug);
  if (!value.every((v) => typeof v === "string" && activeSlugs.includes(v))) {
    return { ok: false };
  }
  return { ok: true, value: Array.from(new Set(value as ClassCategory[])) };
}

export async function POST(request: NextRequest) {
  const sessionUserId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage plans." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage plans." },
      { status: 401 }
    );
  }

  if (staffUser.role !== "staff") {
    return NextResponse.json(
      { success: false, message: "Only staff can manage plans." },
      { status: 403 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const {
    id,
    name,
    description,
    priceEur,
    billingInterval,
    monthlySessionAllowance,
    allowedCategories,
    isActive,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json(
      { success: false, message: "Plan name is required." },
      { status: 400 }
    );
  }

  if (
    typeof priceEur !== "string" ||
    !priceEur.trim() ||
    Number.isNaN(Number(priceEur)) ||
    Number(priceEur) < 0
  ) {
    return NextResponse.json(
      { success: false, message: "A valid price is required." },
      { status: 400 }
    );
  }

  if (typeof billingInterval !== "string" || !BILLING_INTERVALS.includes(billingInterval as BillingInterval)) {
    return NextResponse.json(
      { success: false, message: "A valid billing interval is required." },
      { status: 400 }
    );
  }

  const allowanceResult = parseSessionAllowance(monthlySessionAllowance);

  if (!allowanceResult.ok) {
    return NextResponse.json(
      {
        success: false,
        message: "Session allowance must be \"unlimited\" or a whole number greater than zero.",
      },
      { status: 400 }
    );
  }

  const categoriesResult = parseAllowedCategories(allowedCategories);

  if (!categoriesResult.ok) {
    return NextResponse.json(
      { success: false, message: "Select at least one class category this plan can book." },
      { status: 400 }
    );
  }

  const existingPlan = typeof id === "string" && id.trim() ? findMembershipPlanById(id) : undefined;
  const now = new Date().toISOString();

  const plan: MembershipPlanRecord = {
    id: existingPlan?.id ?? randomUUID(),
    name: name.trim(),
    description: typeof description === "string" && description.trim() ? description.trim() : null,
    priceCents: Math.round(Number(priceEur) * 100),
    billingInterval: billingInterval as BillingInterval,
    monthlySessionAllowance: allowanceResult.value,
    allowedCategories: categoriesResult.value,
    isActive: typeof isActive === "boolean" ? isActive : true,
    createdAt: existingPlan?.createdAt ?? now,
    updatedAt: now,
  };

  saveMembershipPlan(plan);

  return NextResponse.json(
    { success: true, message: existingPlan ? "Plan updated." : "Plan created." },
    { status: 200 }
  );
}
