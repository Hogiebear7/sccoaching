import { randomUUID } from "crypto";

import { createNotification, findNotificationByDedupeKey, findStaffUsers } from "@/lib/db";
import { listOptIns } from "@/lib/comms-optins";
import { sendEmail } from "@/lib/email";
import type { JobDefinition } from "./types";

/** The owner is told once when this many members have opted in (a list worth a first newsletter). */
export const NEWSLETTER_FIRST_LIST_SIZE = 10;
/** And once on or after this date, with the count (owner plan 2026-11-17: send the first newsletter in mid-December). Override with NEWSLETTER_REMINDER_DATE (YYYY-MM-DD). */
export const DEFAULT_NEWSLETTER_REMINDER_DATE = "2026-12-10";

// Tells the owner when it's time to do something in Resend, so they don't have to remember: when 10 members have opted in, and on the reminder date. Each is
// sent once (the dedupe key), by in-app notification and email.
export const newsletterNudgeJob: JobDefinition = {
  name: "newsletter-nudge",
  description: "Tells the owner when the newsletter list is big enough and when the first newsletter is due.",
  async run() {
    const owners = findStaffUsers().filter((u) => (u.role === "admin_manager" && !u.gymId) || u.role === "platform_operator");
    if (owners.length === 0) return "No owner account to tell.";
    const now = new Date();
    const reminderDate = process.env.NEWSLETTER_REMINDER_DATE?.trim() || DEFAULT_NEWSLETTER_REMINDER_DATE;

    const lists = listOptIns({ gymId: null });
    const gym = lists.filter((o) => o.type === "gym").length;
    const app = lists.length - gym;
    const counts = `${lists.length} opted in (${gym} gym, ${app} app)`;

    const nudges: { key: string; title: string; body: string }[] = [];
    if (lists.length >= NEWSLETTER_FIRST_LIST_SIZE) {
      nudges.push({
        key: "newsletter-list-ready",
        title: "Your newsletter list has passed 10 people",
        body: `${counts}. When you're ready for a first newsletter: Staff users > Newsletter lists, download the gym and app files, and import each into its Resend segment (Audience). Then write the newsletter in Resend > Broadcasts. Ask Claude to draft it for you to approve.`,
      });
    }
    if (now.toISOString().slice(0, 10) >= reminderDate) {
      nudges.push({
        key: `newsletter-first-due:${reminderDate}`,
        title: "Time to send the first newsletter",
        body: `${counts}. Download the lists (Staff users > Newsletter lists), import them into Resend (Audience), and ask Claude to draft the first issue for you to approve.`,
      });
    }
    if (nudges.length === 0) return `${counts}. Nothing to nudge yet.`;

    let sent = 0;
    for (const n of nudges) {
      for (const owner of owners) {
        if (findNotificationByDedupeKey(owner.id, n.key)) continue;
        createNotification({ id: randomUUID(), userId: owner.id, type: "newsletter_nudge", title: n.title, body: n.body, readAt: null, linkHref: "/staff/staff-users", dedupeKey: n.key, createdAt: now.toISOString() });
        await sendEmail({ to: owner.email, subject: n.title, text: n.body, html: `<p>${n.body}</p>`, kind: "owner-alert" });
        sent++;
      }
    }
    return `${counts}. Sent ${sent} reminder${sent === 1 ? "" : "s"}.`;
  },
};
