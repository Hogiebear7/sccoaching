import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getAppStorePurchaseContext } from "@/lib/iap/apple-service";
import { resolveTenantRequest } from "@/lib/tenant-request";

// Delivers the appAccountToken the iOS client must pass to StoreKit (Product.PurchaseOption.appAccountToken) BEFORE it starts
// a purchase. Without it the server refuses to claim the resulting subscription, so this is the only way a purchase can ever
// be tied to an account.
//
// The token is derived from the SESSION user only (a UUID from a server-side HMAC, lib/providers/app-store.ts), never from a
// client-supplied id, and is returned only to that user. Gated by the kill switch, and refused for a member who already holds
// a live paid store subscription, so no second purchase starts. A gym Membership does not prevent a purchase.
export async function GET(request: NextRequest) {
  const tenant = resolveTenantRequest(request);
  if (!tenant.ok) return tenant.response;

  const result = getAppStorePurchaseContext(tenant.ctx.userId);
  if (!result.ok) {
    return NextResponse.json({ success: false, code: result.code, message: result.message }, { status: result.httpStatus });
  }
  return NextResponse.json({ success: true, data: result.data }, { status: 200 });
}
