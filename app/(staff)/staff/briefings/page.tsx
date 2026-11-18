import { buildManagerReport } from "@/lib/manager-report";
import { isPlatformOperator } from "@/lib/permissions";
import { requireStaffPage } from "@/lib/staff-auth";
import { BriefingsView } from "./BriefingsView";

// Weekly and monthly briefings (docs/manager-reports-2026-11.md). Admin and up (reports.view). Everyone sees their own gym's figures; the money, app-only and
// platform sections are built only for the platform owner (lib/manager-report.ts). Read-only: nothing on this page changes anything. The period comes from the URL
// (?cadence=weekly|monthly&p=0 for the last completed one, 1 for the one before, ...) so a link can be shared.
export default async function StaffBriefingsPage({ searchParams }: { searchParams: Promise<{ cadence?: string; p?: string }> }) {
  const staff = await requireStaffPage("reports.view");
  const sp = await searchParams;
  const cadence = sp.cadence === "monthly" ? "monthly" : "weekly";
  const maxOffset = cadence === "weekly" ? 51 : 23;
  const parsed = Number.parseInt(sp.p ?? "0", 10);
  const offset = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), maxOffset) : 0;
  const actor = { id: staff.id, role: staff.role, gymId: isPlatformOperator(staff.role) ? null : staff.gymId ?? null };
  const report = buildManagerReport(actor, cadence, offset);
  return <BriefingsView report={report} offset={offset} maxOffset={maxOffset} />;
}
