import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findGymById, findUserById } from "@/lib/db";
import { domainStateText, gymMayUseCustomEmailDomain } from "@/lib/gym-email-domain";
import { refreshGymEmailDomain } from "@/lib/gym-email-domain-sync";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { requireTenantAccess } from "@/lib/tenant-request";

// "Check again": asks the mail provider to re-check the gym's DNS records. The gym comes from the signed-in admin's account.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  const tenantLock = requireTenantAccess(user);
  if (tenantLock) return tenantLock;
  if (!can(user.role, "gym.manageBranding")) return NextResponse.json({ success: false, message: "Only the gym owner or an admin can change this." }, { status: 403 });

  const gym = user.gymId ? findGymById(user.gymId) : undefined;
  if (!gym) return NextResponse.json({ success: false, message: "This is set up for gyms on the platform." }, { status: 404 });

  const result = await refreshGymEmailDomain(gym, true);
  if (!result.ok) return NextResponse.json({ success: false, message: result.message }, { status: result.status });
  return NextResponse.json({
    success: true,
    data: { allowed: gymMayUseCustomEmailDomain(result.gym), domain: result.gym.emailDomain ?? null, ...domainStateText(result.gym.emailDomain) },
  });
}
