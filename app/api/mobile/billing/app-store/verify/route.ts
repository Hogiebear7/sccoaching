import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { verifyAndClaimAppStoreTransaction } from "@/lib/iap/apple-service";
import { resolveTenantRequest } from "@/lib/tenant-request";

// Called by the iOS app right after StoreKit reports a successful purchase, and for each active subscription found by
// "Restore Purchases". The signed transaction the client hands over is NOT trusted on its own: it is verified against Apple's
// pinned root, and the subscription's state is then read from the App Store Server API (lib/iap/apple-service.ts), which also
// enforces the account binding, first-valid-binding-wins and one paid subscription per account.
//
// The only identity ever used is the signed session user. A client-supplied user or gym id is never read.
// Every failure carries a stable `code`. Provider detail is never returned.
export async function POST(request: NextRequest) {
  const tenant = resolveTenantRequest(request, { unauthenticatedMessage: "You must be signed in to verify a purchase." });
  if (!tenant.ok) return tenant.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { signedTransaction } = (body ?? {}) as Record<string, unknown>;
  const result = await verifyAndClaimAppStoreTransaction(tenant.ctx.userId, signedTransaction);

  if (!result.ok) {
    return NextResponse.json({ success: false, code: result.code, message: result.message }, { status: result.httpStatus });
  }
  return NextResponse.json({ success: true, message: result.message, data: result.data }, { status: result.httpStatus });
}
