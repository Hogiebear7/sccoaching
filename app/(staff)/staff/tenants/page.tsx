import { findGyms } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff-auth";
import { tenantAccess } from "@/lib/tenant-billing";
import { tenantLockoutEnabled } from "@/lib/tenant-lockout";
import { TenantsTable, type TenantRow } from "./TenantsTable";

// Tenant gyms and their platform subscription (docs/tenant-lockout-2026-11.md). Platform operator only (gyms.moderate). Shows where each gym stands and lets the
// operator record what it has paid, its grace period, its payment link and its Stripe customer id. It takes no money and deletes nothing; nothing is ever locked unless the
// server's TENANT_LOCKOUT_ENABLED switch is on, and this page says whether it is.
export default async function StaffTenantsPage() {
  await requireStaffPage("gyms.moderate");
  const now = new Date();
  const rows: TenantRow[] = findGyms()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((g) => {
      const a = tenantAccess(g, now);
      return {
        id: g.id,
        name: g.name,
        slug: g.slug,
        contactEmail: g.contactEmail,
        state: a.state,
        paidThrough: g.platformBilling?.paidThrough ?? "",
        graceEndsOn: a.graceEndsOn,
        graceDays: g.platformBilling?.graceDays ?? null,
        payUrl: g.platformBilling?.payUrl ?? "",
        stripeCustomerId: g.platformBilling?.stripeCustomerId ?? "",
        billed: !!g.platformBilling,
      };
    });
  return <TenantsTable rows={rows} lockoutEnabled={tenantLockoutEnabled()} />;
}
