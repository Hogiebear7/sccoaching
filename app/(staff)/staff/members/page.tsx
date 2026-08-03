import { resolveSubscriptionEntitlement } from "@/lib/membership-entitlement";
import { AGE_BRACKETS, AGE_BRACKET_LABEL, ageBracketForAge, ageFromDateOfBirth } from "@/lib/finance-shared";
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

  // Demographics, not billing — active members only (archived accounts skew
  // the "who's actually here" picture this breakdown is meant to answer).
  const activeMembers = members.filter((m) => !m.archivedAt);
  const bracketCounts = new Map<string, number>();
  for (const member of activeMembers) {
    const profile = findProfileByUserId(member.id);
    const bracket = ageBracketForAge(ageFromDateOfBirth(profile?.dateOfBirth ?? null));
    bracketCounts.set(bracket, (bracketCounts.get(bracket) ?? 0) + 1);
  }
  const ageBreakdown = AGE_BRACKETS.filter((b) => bracketCounts.has(b)).map((bracket) => ({
    bracket,
    label: AGE_BRACKET_LABEL[bracket],
    count: bracketCounts.get(bracket)!,
  }));

  return (
    <MembersActivationView
      rows={rows}
      packages={packages}
      canManageBilling={canManageBilling}
      ageBreakdown={ageBreakdown}
    />
  );
}
