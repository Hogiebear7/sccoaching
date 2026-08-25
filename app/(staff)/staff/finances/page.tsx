import { getFinanceSettings } from "@/lib/db";
import { buildFinanceLedgerLines } from "@/lib/finance";
import { requireStaffPage } from "@/lib/staff-auth";
import { FinancesView } from "./FinancesView";

export default async function StaffFinancesPage() {
  await requireStaffPage("finance.view");

  const lines = buildFinanceLedgerLines();
  const settings = getFinanceSettings();

  return <FinancesView lines={lines} settings={settings} />;
}
