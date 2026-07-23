import { resolveSubscriptionEntitlement } from "@/lib/membership-entitlement";
import {
  findBookingsByClassId,
  findClasses,
  findMembers,
  findMessagesByMemberId,
  findProfileByUserId,
  findRecoveryLogsByUserId,
  findSubscriptionByUserId,
  findWaitlistEntriesByClassId,
  type ClassCategory,
  type SubscriptionStatus,
} from "@/lib/db";
import { isPendingCheckoutStale } from "@/lib/billing";
import { isPeriodLapsed } from "@/lib/membership-status";
import { remainingSessions } from "@/lib/scheduling-status";

export interface MemberOperationalSummary {
  userId: string;
  email: string;
  fullName: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  planName: string | null;
  remainingSessions: number | null;
  latestReadinessScore: number | null;
  lastMessageAt: string | null;
  awaitingReply: boolean;
  attentionReasons: string[];
}

// One row per member, aggregating state that's otherwise scattered across
// subscriptions, recovery logs, and messages — exactly what staff need to
// scan to find who needs attention without opening each member individually.
export function buildMemberOperationalSummaries(): MemberOperationalSummary[] {
  return findMembers().map((user) => {
    const profile = findProfileByUserId(user.id);
    const subscription = findSubscriptionByUserId(user.id);
    const plan = resolveSubscriptionEntitlement(subscription);
    const lapsed = subscription ? isPeriodLapsed(subscription) : false;
    const remaining = plan && subscription ? remainingSessions(plan, subscription) : null;

    const recoveryLogs = findRecoveryLogsByUserId(user.id);
    const latestReadinessScore = recoveryLogs[0]?.readinessScore ?? null;

    const messages = findMessagesByMemberId(user.id);
    const lastMessage = messages[messages.length - 1];
    const awaitingReply = lastMessage?.senderRole === "member";

    const attentionReasons: string[] = [];

    if (subscription?.status === "past_due") attentionReasons.push("Past due");
    if (lapsed) attentionReasons.push("Period lapsed");
    if (
      subscription?.status === "pending" &&
      isPendingCheckoutStale(subscription.updatedAt)
    ) {
      attentionReasons.push("Checkout abandoned");
    }
    if (!subscription || subscription.status === "inactive") {
      attentionReasons.push("No active plan");
    }
    if (subscription?.status === "active" && !lapsed && remaining !== null && remaining <= 0) {
      attentionReasons.push("No sessions remaining");
    }
    if (awaitingReply) attentionReasons.push("Awaiting reply");

    return {
      userId: user.id,
      email: user.email,
      fullName: profile?.fullName ?? null,
      subscriptionStatus: subscription?.status ?? null,
      planName: plan?.name ?? null,
      remainingSessions: remaining,
      latestReadinessScore,
      lastMessageAt: lastMessage?.createdAt ?? null,
      awaitingReply,
      attentionReasons,
    };
  });
}

export interface ClassPressureSummary {
  classId: string;
  title: string;
  category: ClassCategory;
  date: string;
  startTime: string;
  bookedCount: number;
  capacity: number;
  waitlistCount: number;
  isFull: boolean;
}

// Upcoming classes only — past classes aren't operationally actionable.
export function buildUpcomingClassPressureSummaries(): ClassPressureSummary[] {
  const now = Date.now();

  return findClasses()
    .filter((classRecord) => new Date(`${classRecord.date}T${classRecord.startTime}`).getTime() >= now)
    .map((classRecord) => {
      const bookedCount = findBookingsByClassId(classRecord.id).length;
      const waitlistCount = findWaitlistEntriesByClassId(classRecord.id).length;

      return {
        classId: classRecord.id,
        title: classRecord.title,
        category: classRecord.category,
        date: classRecord.date,
        startTime: classRecord.startTime,
        bookedCount,
        capacity: classRecord.capacity,
        waitlistCount,
        isFull: bookedCount >= classRecord.capacity,
      };
    });
}
