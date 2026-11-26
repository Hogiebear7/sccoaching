import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findGyms } from "@/lib/db";
import { authorizeStaffRequest } from "@/lib/staff-auth";
import { tenantAccess } from "@/lib/tenant-billing";
import { tenantLockoutEnabled } from "@/lib/tenant-lockout";

// GET /api/staff/gyms/billing — every tenant gym and where it stands on its platform subscription, for the platform operator. The primary gym is listed as not
// billed. PLATFORM-ONLY (gyms.moderate is the platform_operator role alone). Read-only: it never changes anything, and it never returns a gym's payment secrets (only
// whether a link and a Stripe customer are set).
export async function GET(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "gyms.moderate");
  if (!auth.ok) return auth.response;

  const now = new Date();
  const data = findGyms()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((g) => {
      const access = tenantAccess(g, now);
      return {
        id: g.id,
        slug: g.slug,
        name: g.name,
        status: g.status,
        contactEmail: g.contactEmail,
        billed: !!g.platformBilling,
        state: access.state,
        paidThrough: access.paidThrough,
        graceEndsOn: access.graceEndsOn,
        graceDaysLeft: access.graceDaysLeft,
        graceDays: g.platformBilling?.graceDays ?? null,
        hasPayUrl: !!g.platformBilling?.payUrl,
        hasStripeCustomer: !!g.platformBilling?.stripeCustomerId,
      };
    });
  return NextResponse.json({ success: true, lockoutEnabled: tenantLockoutEnabled(), data });
}
