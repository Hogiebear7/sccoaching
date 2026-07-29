import { resolveSubscriptionEntitlement } from "@/lib/membership-entitlement";
import { can } from "@/lib/permissions";
import { requireStaffPage } from "@/lib/staff-auth";
import {
  findMembers,
  findMembershipPackages,
  findProfileByUserId,
  findSubscriptionByUserId,
} from "@/lib/db";
import { remainingSessions } from "@/lib/scheduling-status";
import { MembersActivationView } from "./MembersActivationView";

export default async function StaffMembersPage() {
  const staffUser = await requireStaffPage("members.view");
  const canManageBilling = can(staffUser.role, "members.billing");
  const packages = findMembershipPackages().filter((p) => p.visible);

  const members = findMembers();

  const rows = members.map((member) => {
    const profile = findProfileByUserId(member.id);
    const sub = findSubscriptionByUserId(member.id);
    const plan = resolveSubscriptionEntitlement(sub);

    return {
      userId: member.id,
      email: member.email,
      fullName: profile?.fullName ?? null,
      joinedAt: member.createdAt,
      archivedAt: member.archivedAt ?? null,
      currentPackageId: sub?.packageId ?? null,
      currentPlanName: plan?.name ?? null,
      currentStatus: sub?.status ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      currentRemainingSessions: plan && sub ? remainingSessions(plan, sub) : null,
    };
  });

  return <MembersActivationView rows={rows} packages={packages} canManageBilling={canManageBilling} />;
}
