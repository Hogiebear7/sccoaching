// Tells the owner when gym email domains are close to the mail provider's plan limit (Resend counts domains per plan), so the plan can be upgraded before a gym is turned away.
// Server-only. The pure part (how close are we) is in lib/gym-email-domain.ts.
import { randomUUID } from "crypto";

import { createNotification, findGyms, findNotificationByDedupeKey, findStaffUsers } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { domainLimitState, emailDomainLimitFromEnv } from "@/lib/gym-email-domain";

export function countGymEmailDomains(): number {
  return findGyms().filter((g) => g.emailDomain).length;
}

/** Sends the owner an alert (notification and email) when the count reaches 80% of the limit (8 of 10) and again when the limit is reached. Each level is sent once. */
export async function alertOwnersIfDomainsNearLimit(now: Date = new Date()): Promise<string> {
  const limit = emailDomainLimitFromEnv();
  const count = countGymEmailDomains();
  const state = domainLimitState(count, limit);
  if (state === "ok") return `${count} of ${limit} gym email domains used. No alert.`;

  const title = state === "full" ? `Gym email domains have reached the limit (${count} of ${limit})` : `Gym email domains are nearly full (${count} of ${limit})`;
  const body =
    state === "full"
      ? `${count} gyms have their own email domain, which is the limit on the current Resend plan, so new gyms cannot add one until you upgrade (Resend > Settings > Billing). If you change plan, set EMAIL_DOMAIN_LIMIT on Hostinger to the new number.`
      : `${count} gyms have their own email domain; the current Resend plan allows ${limit}. Upgrade Resend soon (Settings > Billing) so the next gym is not turned away. If you change plan, set EMAIL_DOMAIN_LIMIT on Hostinger to the new number.`;
  const key = `email-domains:${limit}:${state}`;

  const owners = findStaffUsers().filter((u) => (u.role === "admin_manager" && !u.gymId) || u.role === "platform_operator");
  let alerted = 0;
  for (const owner of owners) {
    if (findNotificationByDedupeKey(owner.id, key)) continue;
    createNotification({ id: randomUUID(), userId: owner.id, type: "email_usage_alert", title, body, readAt: null, linkHref: "/staff", dedupeKey: key, createdAt: now.toISOString() });
    await sendEmail({ to: owner.email, subject: title, text: body, html: `<p>${body}</p>`, kind: "owner-alert" });
    alerted += 1;
  }
  return `${count} of ${limit} gym email domains used (${state}). Alerted ${alerted} owner${alerted === 1 ? "" : "s"}.`;
}
