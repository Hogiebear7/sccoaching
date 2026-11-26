import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getConfiguredTenantBillingWebhookSecret } from "@/lib/app-config";
import { findGymById, findGyms, findMembersInGym, hasPaymentEvent, recordPaymentEvent, saveGym } from "@/lib/db";
import { verifyStripeSignatureWithSecret } from "@/lib/providers/stripe-webhook";
import { isIsoDay } from "@/lib/tenant-billing";
import { bandForCount, bandForNextPeriod, startNewPeriod, tenantPriceMap } from "@/lib/tenant-pricing";
import { intervalFromPeriod, moveSubscriptionToBand } from "@/lib/tenant-subscription";

// POST /api/webhooks/tenant-billing — S&C's OWN Stripe account telling us a tenant gym has paid S&C for the platform (not a member paying a gym: that is
// /api/stripe/webhook). Tenants pay S&C like a gym membership; S&C never holds or moves a tenant's own money.
//
//   invoice.paid -> the gym's paid-through date moves to the end of the period that invoice paid for (never backwards), which lifts a grace period or a lockout at once.
//
// The signature is checked against TENANT_BILLING_WEBHOOK_SECRET, a different secret from the member-payments endpoint, and without it nothing is accepted. The
// gym is found by the Stripe customer id STORED on the gym record (set by a platform operator); nothing in the event body can name a gym, so a forged or
// misrouted event can only ever touch a gym that already carries that customer id. Redelivery is harmless: each event id is applied once. Unknown events and
// customers are acknowledged with a 200 and ignored, so Stripe does not retry them for ever.
export async function POST(request: NextRequest) {
  const secret = getConfiguredTenantBillingWebhookSecret();
  if (!secret) {
    return NextResponse.json({ success: false, message: "Tenant billing webhook is not configured." }, { status: 401 });
  }

  const rawBody = await request.text();
  if (!verifyStripeSignatureWithSecret(secret, rawBody, request.headers.get("stripe-signature"))) {
    console.warn("[tenant billing webhook] rejected: invalid signature");
    return NextResponse.json({ success: false, message: "Invalid webhook signature." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const event = (payload ?? {}) as { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  if (typeof event.id !== "string" || typeof event.type !== "string" || !event.data?.object) {
    return NextResponse.json({ success: false, message: "Malformed event." }, { status: 400 });
  }

  const key = `tenant-billing:${event.id}`;
  if (hasPaymentEvent(key)) return NextResponse.json({ success: true, message: "Event already processed." }, { status: 200 });

  const object = event.data.object;
  const ack = (message: string, entityId: string | null) => {
    recordPaymentEvent({ key, provider: "stripe", type: event.type as string, entityId, receivedAt: new Date().toISOString(), ownerGym: { scope: "platform" } });
    return NextResponse.json({ success: true, message }, { status: 200 });
  };

  if (event.type !== "invoice.paid") return ack("Ignored event type.", null);

  const customer = typeof object.customer === "string" ? object.customer : null;
  const invoiceId = typeof object.id === "string" ? object.id : null;
  if (!customer) return ack("Ignored: no customer.", invoiceId);

  // The end of the period the invoice paid for: the latest period end across its lines.
  const lines = ((object.lines as { data?: unknown } | undefined)?.data ?? []) as Array<{ period?: { start?: unknown; end?: unknown } }>;
  const ends = lines.map((l) => l?.period?.end).filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  if (ends.length === 0) return ack("Ignored: no paid period on the invoice.", invoiceId);
  const paidThrough = new Date(Math.max(...ends) * 1000).toISOString().slice(0, 10);
  if (!isIsoDay(paidThrough)) return ack("Ignored: bad period.", invoiceId);

  const gym = findGyms().find((g) => g.platformBilling?.stripeCustomerId === customer || g.pendingStripeCustomerId === customer);
  if (!gym) {
    console.warn("[tenant billing webhook] invoice for a customer no gym carries");
    return ack("Ignored: no gym has this customer.", invoiceId);
  }

  // Never move the date backwards: an old invoice redelivered late must not shorten a gym that has since paid further ahead.
  if (!gym.platformBilling) {
    // The gym's first payment: it becomes a billed gym only now, so starting checkout and walking away never gave it any free time.
    const { pendingStripeCustomerId: _pending, ...rest } = gym;
    void _pending;
    const now = new Date().toISOString();
    saveGym({ ...rest, platformBilling: { paidThrough, stripeCustomerId: customer, firstPaidAt: now }, updatedAt: now });
  } else if (paidThrough > gym.platformBilling.paidThrough) {
    saveGym({ ...gym, platformBilling: { ...gym.platformBilling, paidThrough }, updatedAt: new Date().toISOString() });
  }

  // Size-based pricing (only when TENANT_PRICES is set): on the first payment the gym's band comes from its member count now; on a renewal the NEXT period's band comes from the
  // highest member count of the period just ended, so removing members before the end of the month does not lower it (lib/tenant-pricing.ts).
  if (tenantPriceMap()) {
    const starts = lines.map((l) => l?.period?.start).filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
    const interval = intervalFromPeriod(starts.length ? Math.min(...starts) : 0, Math.max(...ends));
    const live = findMembersInGym(gym.id).length;
    const before = findGymById(gym.id)?.platformBilling;
    const first = !before?.band;
    const nextBand = first ? bandForCount(live) : bandForNextPeriod(before?.memberHighWater, live);
    const band = first ? nextBand : await moveSubscriptionToBand(customer, interval, before?.band, nextBand);
    // The Stripe call above was awaited after the gym was read: apply the band to the gym as it is NOW.
    const fresh = findGymById(gym.id);
    if (fresh?.platformBilling) {
      saveGym({ ...fresh, platformBilling: { ...fresh.platformBilling, band, interval, memberHighWater: startNewPeriod(live, new Date().toISOString().slice(0, 10)) }, updatedAt: new Date().toISOString() });
    }
  }
  return ack("Gym marked paid.", invoiceId);
}
