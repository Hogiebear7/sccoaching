import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findGymById, saveGym } from "@/lib/db";
import { createTenantCheckout, createTenantCustomer, createTenantPortal, tenantSubscriptionConfigured } from "@/lib/tenant-subscription";
import { resolveStaffTenantRequest } from "@/lib/tenant-request";

// POST /api/staff/gym/subscription { action: "checkout" | "portal" } — a gym's own admin pays S&C for the platform, or manages that subscription. The gym is always the acting
// admin's own (from their account, never from the request). Returns a Stripe page to send the browser to; nothing is marked paid here, the invoice.paid webhook does that.
//
// A gym that has never been billed gets a paid-through date of today the first time it starts checkout, so that a gym which starts and then walks away is warned, and then
// locked after the usual grace, instead of staying free for ever. Starting checkout again never moves that date.

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  const auth = resolveStaffTenantRequest(request, "gym.manageBranding", { allowWhenLocked: true });
  if (!auth.ok) return auth.response;
  if (!auth.user.gymId) return NextResponse.json({ success: false, message: "S&C's own gym has no platform subscription." }, { status: 403 });
  const gym = findGymById(auth.user.gymId);
  if (!gym) return NextResponse.json({ success: false, message: "No gym found for this account." }, { status: 404 });
  if (!tenantSubscriptionConfigured()) return NextResponse.json({ success: false, message: "Online payment is not switched on yet. The platform team will send you a payment link." }, { status: 503 });

  let action: unknown;
  try {
    action = ((await request.json()) as { action?: unknown }).action;
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  if (action !== "checkout" && action !== "portal") return NextResponse.json({ success: false, message: "Choose checkout or portal." }, { status: 400 });

  let customerId = gym.platformBilling?.stripeCustomerId ?? null;
  if (!customerId) {
    const created = await createTenantCustomer(gym, auth.user.email);
    if (!created.ok) return NextResponse.json({ success: false, message: created.message }, { status: 502 });
    customerId = created.customerId;
    saveGym({
      ...gym,
      platformBilling: { ...(gym.platformBilling ?? { paidThrough: today() }), stripeCustomerId: customerId },
      updatedAt: new Date().toISOString(),
    });
  }

  const result = action === "checkout" ? await createTenantCheckout(gym, customerId) : await createTenantPortal(customerId);
  if (!result.ok) return NextResponse.json({ success: false, message: result.message }, { status: 502 });
  return NextResponse.json({ success: true, data: { url: result.url } });
}
