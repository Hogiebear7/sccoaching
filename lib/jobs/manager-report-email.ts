import { currentHourInGymTimeZone, gymLocalDateString } from "@/lib/class-time";
import { findStaffUsers } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { buildManagerReport, type ReportCadence } from "@/lib/manager-report";
import { reportSubject, reportToHtml, reportToText } from "@/lib/manager-report-render";
import { getSiteUrl } from "@/lib/site-url";
import type { JobDefinition } from "./types";

// Emails the weekly and monthly manager briefings (docs/manager-reports-2026-11.md). READ-ONLY: it reads figures and sends one email to each owner or gym manager,
// never anything to a member. The platform owner gets the full briefing (gym, money, app, platform); a gym manager gets their own gym's figures only.
//
//   Weekly:  Monday or Tuesday (Irish time), from 07:00. Covers the Monday to Sunday that just ended.
//   Monthly: the 5th to the 12th of the month, from 07:00. The wait gives time to enter the Apple and Google payouts in Staff > Finances first.
// Each person gets each period's email once (the email send log's once-only key), so the job running every 15 minutes, a redeploy or a late start never repeats one.
// MANAGER_REPORTS_EMAIL=off on Hostinger switches it off.
const SEND_FROM_HOUR = 7;

function dueCadences(now: Date): ReportCadence[] {
  if (currentHourInGymTimeZone(now) < SEND_FROM_HOUR) return [];
  const today = gymLocalDateString(now); // YYYY-MM-DD in Dublin
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sunday ... 6 Saturday
  const day = Number(today.slice(8, 10));
  const due: ReportCadence[] = [];
  if (dow === 1 || dow === 2) due.push("weekly");
  if (day >= 5 && day <= 12) due.push("monthly");
  return due;
}

export const managerReportEmailJob: JobDefinition = {
  name: "manager-report-email",
  description: "Emails the weekly (Monday) and monthly (from the 5th) manager briefings to owners and gym managers.",
  timeoutMs: 60_000,
  async run() {
    if (process.env.MANAGER_REPORTS_EMAIL?.trim().toLowerCase() === "off") return "Manager briefing emails are switched off (MANAGER_REPORTS_EMAIL=off).";
    const now = new Date();
    const due = dueCadences(now);
    if (due.length === 0) return "No briefing is due now.";

    const recipients = findStaffUsers().filter((u) => !u.archivedAt && (u.role === "admin_manager" || u.role === "platform_operator"));
    const siteUrl = getSiteUrl();
    let sent = 0;
    for (const cadence of due) {
      for (const user of recipients) {
        const actor = { id: user.id, role: user.role, gymId: user.role === "platform_operator" ? null : user.gymId ?? null };
        const report = buildManagerReport(actor, cadence, 0, now);
        const link = `${siteUrl}/staff/briefings?cadence=${cadence}`;
        await sendEmail({
          to: user.email,
          subject: reportSubject(report),
          text: reportToText(report, link),
          html: reportToHtml(report, link),
          kind: "manager-report",
          dedupeKey: `manager-report:${cadence}:${report.period.key}:${user.id}`,
        });
        sent++;
      }
    }
    return `Sent ${sent} briefing email${sent === 1 ? "" : "s"} (${due.join(" and ")}) to ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}.`;
  },
};
