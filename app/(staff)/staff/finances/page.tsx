import { findAllAiUsageLogs, findSubscriptionByUserId, findUserById, getFinanceSettings } from "@/lib/db";
import { buildFinanceLedgerLines } from "@/lib/finance";
import type { AiUsageCohort } from "@/lib/finance-shared";
import { resolveMemberTier } from "@/lib/membership-entitlement";
import { isStaffRole } from "@/lib/permissions";
import { requireStaffPage } from "@/lib/staff-auth";
import { FinancesView } from "./FinancesView";

// Which cohort an AiUsageLogRecord's cost counts against, for the Finances
// page's cohort breakdown — a staff account (no subscription of its own)
// resolves to "staff" before ever reaching resolveMemberTier, which would
// otherwise misread it as "free".
function cohortForUserId(userId: string | null): AiUsageCohort {
  if (!userId) return "unattributed";
  const user = findUserById(userId);
  if (!user) return "unattributed";
  if (isStaffRole(user.role)) return "staff";
  const tier = resolveMemberTier(findSubscriptionByUserId(userId));
  if (tier === "membership") return "membership";
  if (tier === "app_subscription") return "app_subscription";
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
