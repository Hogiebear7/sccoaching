import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getPurchaseContext } from "@/lib/iap/service";
import { resolveTenantRequest } from "@/lib/tenant-request";

// Delivers the account binding the Android client must set (setObfuscatedAccountId) BEFORE it launches the
// purchase flow. Without it the server refuses to claim the resulting token, so this is the only way a purchase
// can ever be tied to an account.
//
// The binding is derived from the SESSION user only (a one-way HMAC, lib/providers/google-play.ts), never from a
// client-supplied id, and is returned only to that user. Gated by the kill switch, and refused for a member who
// cannot take a purchase (active Membership, or a live Google Play subscription), so no purchase intent starts.
export async function GET(request: NextRequest) {
  const tenant = resolveTenantRequest(request);
  if (!tenant.ok) return tenant.response;

  const result = getPurchaseContext(tenant.ctx.userId);
  if (!result.ok) {
    return NextResponse.json({ success: false, code: result.code, message: result.message }, { status: result.httpStatus });
  }
  return NextResponse.json({ success: true, data: result.data }, { status: 200 });
}
