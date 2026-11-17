import { randomUUID } from "crypto";

import { countEmailSendsSince, createNotification, findNotificationByDedupeKey, findStaffUsers } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { emailLimitsFromEnv, usageAlertsFor, usageWindows } from "@/lib/email-usage";
import type { JobDefinition } from "./types";

// Tells the owner when the emails we send reach 80% of Resend's daily (100) or monthly (3,000) free-plan caps, once per day and once per month, by in-app
// notification and email. The counts come from our own send log (lib/db.ts emailSendLog), which has every email we handed to Resend. Limits can be changed
// with EMAIL_DAILY_LIMIT and EMAIL_MONTHLY_LIMIT on Hostinger if the Resend plan changes.
export const checkEmailUsageJob: JobDefinition = {
  name: "check-email-usage",
  description: "Tells the owner when email sending passes 80% of Resend's daily or monthly cap.",
  async run() {
    const now = new Date();
    const w = usageWindows(now);
    const used = { day: countEmailSendsSince(w.dayStart), month: countEmailSendsSince(w.monthStart) };
    const limits = emailLimitsFromEnv();
    const alerts = usageAlertsFor(used, limits, now);
    if (alerts.length === 0) return `Emails sent: ${used.day} today of ${limits.daily}, ${used.month} this month of ${limits.monthly}. No alert.`;

    const owners = findStaffUsers().filter((u) => (u.role === "admin_manager" && !u.gymId) || u.role === "platform_operator");
    let alerted = 0;
    for (const a of alerts) {
      const title = `Email sending is at ${Math.round((a.used / a.limit) * 100)}% of the ${a.scope} limit`;
      const body = `${a.used} emails sent ${a.scope === "daily" ? "today" : "this month"} of the ${a.limit} Resend allows on the current plan. Past the limit, emails stop sending until the ${a.scope === "daily" ? "day" : "month"} resets or you upgrade (Resend > Settings). If the plan changes, update EMAIL_${a.scope === "daily" ? "DAILY" : "MONTHLY"}_LIMIT on Hostinger.`;
      for (const owner of owners) {
        if (findNotificationByDedupeKey(owner.id, a.key)) continue;
        createNotification({ id: randomUUID(), userId: owner.id, type: "email_usage_alert", title, body, readAt: null, linkHref: "/staff", dedupeKey: a.key, createdAt: now.toISOString() });
        await sendEmail({ to: owner.email, subject: title, text: body, html: `<p>${body}</p>`, kind: "owner-alert" });
        alerted++;
      }
    }
    return `Emails sent: ${used.day} today, ${used.month} this month. Alerted ${alerted} owner${alerted === 1 ? "" : "s"}.`;
  },
};
