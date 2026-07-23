import { randomUUID } from "crypto";

import {
  createNotification,
  findMembers,
  findNotificationByDedupeKey,
  findPassLedgerByUserId,
  findProfileByUserId,
  findSubscriptionByUserId,
} from "@/lib/db";
import { resolveSubscriptionEntitlement } from "@/lib/membership-entitlement";
import { sendEmail } from "@/lib/email";
import { lowPassBalanceEmail } from "@/lib/email-templates";
import { isPeriodLapsed } from "@/lib/membership-status";
import { purchasedPassBalance } from "@/lib/payments";
import { remainingSessions } from "@/lib/scheduling-status";
import type { JobDefinition } from "./types";

// Class passes stay one-off purchases — no automatic rebilling. Instead the
// member gets a short heads-up at 3, 2 and 1 usable classes remaining so
// they can top up themselves.
//
// "Usable remaining" = plan-period remaining (allowance + staff grants −
// used, only while the membership is active and unlapsed) + the expiry-aware
// purchased-pass balance. Unlimited plans are never low. Each threshold
// fires once per BALANCE EPISODE: the dedupe key carries a marker that
// changes whenever the balance is replenished (a new billing period or a
// new positive ledger credit), so a member warned at 2 last month is warned
// again next time they run down — but never twice for the same run-down.
const THRESHOLDS = [1, 2, 3];

export const notifyLowPassBalanceJob: JobDefinition = {
  name: "notify-low-pass-balance",
  description: "Warns members once per run-down when 3, 2 or 1 usable class passes remain.",
  async run() {
    let notifiedCount = 0;

    for (const member of findMembers()) {
      if (member.archivedAt) continue;

      const subscription = findSubscriptionByUserId(member.id);
      const plan = resolveSubscriptionEntitlement(subscription);
      const planIsLive =
        !!subscription &&
        !!plan &&
        subscription.status === "active" &&
        !isPeriodLapsed(subscription);

      // Unlimited plans can always book — never "low".
      if (planIsLive && plan.monthlySessionAllowance === null) continue;

      const planRemaining = planIsLive ? remainingSessions(plan, subscription) ?? 0 : 0;
      const packRemaining = Math.max(0, purchasedPassBalance(member.id));
      const usable = planRemaining + packRemaining;

      if (usable < 1 || usable > 3 || !THRESHOLDS.includes(usable)) continue;

      // Episode marker: changes when a new billing period starts or a new
      // credit lands in the ledger — re-arming the thresholds.
      const latestCredit = [...findPassLedgerByUserId(member.id)]
        .filter((e) => e.delta > 0)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const episode = `${planIsLive ? subscription.currentPeriodEnd ?? "open" : "noplan"}|${latestCredit?.id ?? "nocredit"}`;

      const dedupeKey = `pass-low:${usable}:${episode}`;
      if (findNotificationByDedupeKey(member.id, dedupeKey)) continue;

      const noun = usable === 1 ? "class pass" : "class passes";
      createNotification({
        id: randomUUID(),
        userId: member.id,
        type: "membership",
        title: `You have ${usable} ${noun} remaining`,
        body: `You have ${usable} ${noun} remaining. Top up on the Membership page so you never miss a session.`,
        readAt: null,
        linkHref: "/dashboard/membership",
        dedupeKey,
        createdAt: new Date().toISOString(),
      });

      const profile = findProfileByUserId(member.id);
      if (profile?.emailNotificationsEnabled !== false && profile?.email) {
        void sendEmail({
          to: profile.email,
          ...lowPassBalanceEmail({
            memberName: profile.fullName || profile.email,
            remaining: usable,
          }),
        });
      }

      notifiedCount += 1;
    }

    return notifiedCount === 0
      ? "No members with a low pass balance to warn."
      : `Warned ${notifiedCount} member${notifiedCount === 1 ? "" : "s"} about a low class-pass balance.`;
  },
};
