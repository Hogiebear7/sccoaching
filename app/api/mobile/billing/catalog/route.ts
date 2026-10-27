import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { trialCapacity } from "@/lib/ai-allowance";
import { getDigitalPlanCatalog } from "@/lib/iap/apple-service";
import { resolveTenantRequest } from "@/lib/tenant-request";

// The store product identifiers the app should ask Google Play / the App Store about. Carries NO price: the app shows the
// price, billing period and renewal terms the STORE returns, because the store is the only authority on what a member will
// be charged in their country.
export async function GET(request: NextRequest) {
  const tenant = resolveTenantRequest(request);
  if (!tenant.ok) return tenant.response;
  // Whether a new free trial could be honoured with its AI allowance right now (lib/ai-allowance.ts trialCapacity). The store starts a trial, not this server, so
  // this only decides whether the app may REPRESENT the trial as available. An app that does not read it must not promise a trial.
  const trialAvailable = trialCapacity().available;
  return NextResponse.json({ success: true, data: { plans: getDigitalPlanCatalog().map((plan) => ({ ...plan, trialAvailable })) } }, { status: 200 });
}
