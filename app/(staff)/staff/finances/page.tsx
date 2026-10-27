import { findAllAiUsageLogs, findUserById, getFinanceSettings } from "@/lib/db";
import { buildFinanceLedgerLines } from "@/lib/finance";
import type { AiUsageCohort } from "@/lib/finance-shared";
import { resolveMemberAccessForUser } from "@/lib/membership-entitlement";
import { isStaffRole } from "@/lib/permissions";
import { requireStaffPage } from "@/lib/staff-auth";
import { FinancesView } from "./FinancesView";

// Which cohort an AiUsageLogRecord's cost counts against, for the Finances
// page's cohort breakdown — a staff account (no subscription of its own)
// resolves to "staff" before ever reaching resolveMemberAccessForUser, which
// would otherwise misread it as "free". Digital access wins over a gym Membership: the AI cost is incurred by the digital
// entitlement.
function cohortForUserId(userId: string | null): AiUsageCohort {
  if (!userId) return "unattributed";
  const user = findUserById(userId);
  if (!user) return "unattributed";
  if (isStaffRole(user.role)) return "staff";
  const access = resolveMemberAccessForUser(userId);
  if (access.digital) return "app_subscription";
  if (access.gymMembership) return "membership";
  return "free";
}

export default async function StaffFinancesPage() {
  await requireStaffPage("finance.view");

  const lines = buildFinanceLedgerLines();
  const settings = getFinanceSettings();
  // Thin, serializable projection — a function like cohortForUserId can't
  // cross the server/client prop boundary, so cohort is resolved once here.
  const aiUsageByCohort = findAllAiUsageLogs().map((log) => ({
    costUsd: log.costUsd,
    createdAt: log.createdAt,
    cohort: cohortForUserId(log.userId),
  }));

  return <FinancesView lines={lines} settings={settings} aiUsageByCohort={aiUsageByCohort} />;
}
