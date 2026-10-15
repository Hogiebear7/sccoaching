import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getDigitalPlanCatalog } from "@/lib/iap/apple-service";
import { resolveTenantRequest } from "@/lib/tenant-request";

// The store product identifiers the app should ask Google Play / the App Store about. Carries NO price: the app shows the
// price, billing period and renewal terms the STORE returns, because the store is the only authority on what a member will
// be charged in their country.
export async function GET(request: NextRequest) {
  const tenant = resolveTenantRequest(request);
  if (!tenant.ok) return tenant.response;
  return NextResponse.json({ success: true, data: { plans: getDigitalPlanCatalog() } }, { status: 200 });
}
