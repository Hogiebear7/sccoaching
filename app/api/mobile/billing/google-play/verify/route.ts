import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { verifyAndClaimPurchase } from "@/lib/iap/service";
import { verifyRequestSession } from "@/lib/mobile-auth";

// Called by the mobile app right after Google Play Billing reports a successful purchase (or on "restore
// purchases"). The token the client hands over is NOT trusted on its own: everything about the purchase is
// re-derived from a live call to Google inside lib/iap/service.ts, which also enforces every rule in the plan
// (docs/iap-multitenant-implementation-plan-2026-10.md): the kill switch, first-valid-binding-wins, no overlap with
// an active Membership, acknowledgement only after entitlement, idempotency for the same account.
//
// The only identity ever used is the signed session user. A client-supplied user or gym id is never read.
//
// Response contract (also in docs/google-play-server-contract-2026-10.md): every failure carries a stable `code`.
// Provider detail is never returned.
export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  if (!sessionUserId) {
    return NextResponse.json({ success: false, message: "You must be signed in to verify a purchase." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { purchaseToken } = (body ?? {}) as Record<string, unknown>;
  const result = await verifyAndClaimPurchase(sessionUserId, purchaseToken);

  if (!result.ok) {
    return NextResponse.json({ success: false, code: result.code, message: result.message }, { status: result.httpStatus });
  }
  return NextResponse.json({ success: true, message: result.message, data: result.data }, { status: result.httpStatus });
}
