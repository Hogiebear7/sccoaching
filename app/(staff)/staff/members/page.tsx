import { resolveSubscriptionEntitlement } from "@/lib/membership-entitlement";
import { AGE_BRACKETS, AGE_BRACKET_LABEL, ageBracketForAge, ageFromDateOfBirth } from "@/lib/finance-shared";
import { sameGym } from "@/lib/gym-scope";
import { can } from "@/lib/permissions";
import { requireStaffPage } from "@/lib/staff-auth";
import {
  findMembersAndStaff,
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

  // A staff account only ever sees members (and other staff) at their own
  // gym — see lib/gym-scope.ts. Every pre-existing account (staff and
  // member alike) implicitly belongs to the primary gym, so this is a no-op
  // until a second gym's staff/members actually exist. findMembersAndStaff
  // (not findMembers) so every staff account's own AI usage is reachable
  // from this same list — see lib/db.ts's comment on that function.
  const members = findMembersAndStaff().filter((m) => sameGym(staffUser, m));

  const rows = members.map((member) => {
    const profile = findProfileByUserId(member.id);
    const isStaffRow = member.role !== "member";
    // Subscription/billing concepts don't apply to a staff account — left
    // null rather than relying on these lookups implicitly returning
    // nothing for a staff id.
    const sub = isStaffRow ? undefined : findSubscriptionByUserId(member.id);
    const plan = isStaffRow ? undefined : resolveSubscriptionEntitlement(sub);

    return {
      userId: member.id,
      email: member.email,
      fullName: profile?.fullName ?? null,
      joinedAt: member.createdAt,
      archivedAt: member.archivedAt ?? null,
      role: member.role,
      currentPackageId: isStaffRow ? null : (sub?.packageId ?? null),
      currentPlanName: isStaffRow ? null : (plan?.name ?? null),
      currentStatus: isStaffRow ? null : (sub?.status ?? null),
      currentPeriodEnd: isStaffRow ? null : (sub?.currentPeriodEnd ?? null),
      currentRemainingSessions: isStaffRow ? null : (plan && sub ? remainingSessions(plan, sub) : null),
    };
  });

  // Demographics, not billing — active MEMBERS only (archived accounts skew
  // the "who's actually here" picture this breakdown is meant to answer,
  // and staff have no meaningful demographic bracket for it at all).
  const activeMembers = members.filter((m) => !m.archivedAt && m.role === "member");
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
