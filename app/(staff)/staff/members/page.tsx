import { resolveSubscriptionEntitlement } from "@/lib/membership-entitlement";
import {
  findMembers,
  findMembershipPlans,
  findProfileByUserId,
  findSubscriptionByUserId,
} from "@/lib/db";
import { remainingSessions } from "@/lib/scheduling-status";
import { MembersActivationView } from "./MembersActivationView";

export default async function StaffMembersPage() {
  const members = findMembers();
  const activePlans = findMembershipPlans().filter((p) => p.isActive);

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
      currentPlanId: sub?.planId ?? null,
      currentPlanName: plan?.name ?? null,
      currentStatus: sub?.status ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      currentRemainingSessions: plan && sub ? remainingSessions(plan, sub) : null,
    };
  });

  return <MembersActivationView rows={rows} plans={activePlans} />;
}
