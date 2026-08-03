import { getFinanceSettings } from "@/lib/db";
import { buildRevenueLines } from "@/lib/finance";
import { requireStaffPage } from "@/lib/staff-auth";
import { FinancesView } from "./FinancesView";

export default async function StaffFinancesPage() {
  await requireStaffPage("finance.view");

  const lines = buildRevenueLines();
  const settings = getFinanceSettings();

  return <FinancesView lines={lines} taxRatePercent={settings.taxRatePercent} />;
}
