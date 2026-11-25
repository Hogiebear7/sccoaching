import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findGymById, findMembersInGym, saveGym } from "@/lib/db";
import { createTenantCheckout, createTenantCustomer, createTenantPortal, tenantSubscriptionConfigured } from "@/lib/tenant-subscription";
import { resolveStaffTenantRequest } from "@/lib/tenant-request";

// POST /api/staff/gym/subscription { action: "checkout" | "portal" } — a gym's own admin pays S&C for the platform, or manages that subscription. The gym is always the acting
// admin's own (from their account, never from the request). Returns a Stripe page to send the browser to; nothing is marked paid here, the invoice.paid webhook does that.
//
// Starting checkout gives a gym NO free time. Its Stripe customer is remembered as pendingStripeCustomerId only; it becomes a billed gym (with a paid-through date) when the
// first invoice is actually paid (the webhook). A gym that starts and walks away stays unbilled and, because the platform team approves gyms by hand, is never listed.

export async function POST(request: NextRequest) {
  const auth = resolveStaffTenantRequest(request, "gym.manageBranding", { allowWhenLocked: true });
  if (!auth.ok) return auth.response;
  if (!auth.user.gymId) return NextResponse.json({ success: false, message: "S&C's own gym has no platform subscription." }, { status: 403 });
  const gym = findGymById(auth.user.gymId);
  if (!gym) return NextResponse.json({ success: false, message: "No gym found for this account." }, { status: 404 });
  if (!tenantSubscriptionConfigured()) return NextResponse.json({ success: false, message: "Online payment is not switched on yet. The platform team will send you a payment link." }, { status: 503 });

  let action: unknown;
  let interval: unknown;
  try {
    const body = (await request.json()) as { action?: unknown; interval?: unknown };
    action = body.action;
    interval = body.interval;
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  if (action !== "checkout" && action !== "portal") return NextResponse.json({ success: false, message: "Choose checkout or portal." }, { status: 400 });

  let customerId = gym.platformBilling?.stripeCustomerId ?? gym.pendingStripeCustomerId ?? null;
  if (!customerId) {
    const created = await createTenantCustomer(gym, auth.user.email);
    if (!created.ok) return NextResponse.json({ success: false, message: created.message }, { status: 502 });
    customerId = created.customerId;
    // Stripe was awaited after the gym was read: apply the customer id to the gym as it is NOW.
    const fresh = findGymById(gym.id) ?? gym;
    saveGym(
      fresh.platformBilling
        ? { ...fresh, platformBilling: { ...fresh.platformBilling, stripeCustomerId: customerId }, updatedAt: new Date().toISOString() }
        : { ...fresh, pendingStripeCustomerId: customerId, updatedAt: new Date().toISOString() }
    );
  }

  const chosen = interval === "year" ? "year" : "month";
  const result = action === "checkout" ? await createTenantCheckout(gym, customerId, chosen, findMembersInGym(gym.id).length) : await createTenantPortal(customerId);
  if (!result.ok) return NextResponse.json({ success: false, message: result.message }, { status: 502 });
  return NextResponse.json({ success: true, data: { url: result.url } });
}
