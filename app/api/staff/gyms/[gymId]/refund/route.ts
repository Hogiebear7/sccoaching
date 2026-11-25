import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findGymById, saveGym } from "@/lib/db";
import { PRIMARY_GYM_SLUG } from "@/lib/primary-gym";
import { authorizeStaffRequest } from "@/lib/staff-auth";
import { refundableUntil, refundAndCancel } from "@/lib/tenant-subscription";

// POST /api/staff/gyms/[gymId]/refund — the 14-day money-back. Platform operator only (gyms.moderate), never for the operator's own gym, and only while the gym is inside its
// 14 days from its first payment. It refunds the latest paid charge in Stripe, cancels the subscription, and ends the gym's paid time (paid-through yesterday, no grace) so
// access stops straight away. Nothing is deleted, and if the gym pays again everything comes back.
export async function POST(request: NextRequest, { params }: { params: Promise<{ gymId: string }> }) {
  const auth = authorizeStaffRequest(request, "gyms.moderate");
  if (!auth.ok) return auth.response;

  const { gymId } = await params;
  const gym = findGymById(gymId);
  if (!gym) return NextResponse.json({ success: false, message: "Gym not found." }, { status: 404 });
  const isOwnGym = auth.user.gymId ? gym.id === auth.user.gymId : gym.slug === PRIMARY_GYM_SLUG;
  if (isOwnGym) return NextResponse.json({ success: false, message: "A gym can't refund itself." }, { status: 403 });

  const billing = gym.platformBilling;
  const until = refundableUntil(billing?.firstPaidAt);
  if (!billing?.stripeCustomerId || !until) return NextResponse.json({ success: false, message: "This gym has no first payment on record to refund." }, { status: 400 });
  if (new Date().toISOString().slice(0, 10) > until) {
    return NextResponse.json({ success: false, message: `The 14-day money-back ended on ${until}. Refund it in Stripe if you decide to make an exception.` }, { status: 400 });
  }

  const result = await refundAndCancel(billing.stripeCustomerId);
  if (!result.ok) return NextResponse.json({ success: false, message: result.message }, { status: 502 });

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  // Stripe was awaited after the gym was read: apply the change to the gym as it is NOW.
  const fresh = findGymById(gymId) ?? gym;
  saveGym({ ...fresh, platformBilling: { ...(fresh.platformBilling ?? billing), paidThrough: yesterday, graceDays: 0 }, updatedAt: new Date().toISOString() });
  return NextResponse.json({ success: true, message: "Refunded, subscription cancelled and access ended." });
}
