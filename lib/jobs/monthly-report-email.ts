import { randomUUID } from "crypto";

import { createNotification, findNotificationByDedupeKey, findStaffUsers } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { buildMasterWorkbook, rangeBounds } from "@/lib/exports";
import { toXlsx } from "@/lib/exports-format";
import type { JobDefinition } from "./types";

// Emails each gym's managers last month's master workbook on the first days of the month (admin revamp slice S5,
// docs/admin-revamp-plan-2026-10.md): every sheet of Staff > Exports for the previous calendar month, attached as one Excel file, with the
// Summary figures in the email itself. Admin managers get their own gym's report; platform operators get the primary gym's. Once per person
// per month (the notification's dedupe key), and only in the first 7 days of a month, so a deploy mid-month never sends a stale report.
const SEND_WINDOW_DAYS = 7;

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function formatValue(measure: string, value: string | number | null): string {
  if (value === null) return "—";
  if (typeof value === "string") return value;
  if (measure.includes("fill rate")) return `${Math.round(value * 1000) / 10}%`;
  if (measure.includes("(€)")) return `€${value.toFixed(2)}`;
  return value.toLocaleString("en-IE");
}

export const monthlyReportEmailJob: JobDefinition = {
  name: "monthly-report-email",
  description: "Emails gym managers last month's master workbook (all export sheets) in the first week of the month.",
  async run() {
    const now = new Date();
    if (now.getUTCDate() > SEND_WINDOW_DAYS) return `Not in the first ${SEND_WINDOW_DAYS} days of the month; nothing to send.`;
    const { start } = rangeBounds("last-month", now);
    const month = start!.slice(0, 7);
    const monthName = new Date(`${start}T00:00:00Z`).toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" });
    const dedupeKey = `monthly-report:${month}`;
    const recipients = findStaffUsers().filter((u) => !u.archivedAt && (u.role === "admin_manager" || u.role === "platform_operator"));

    let sent = 0;
    for (const user of recipients) {
      if (findNotificationByDedupeKey(user.id, dedupeKey)) continue;
      const gymId = user.role === "platform_operator" ? null : user.gymId ?? null;
      const sheets = buildMasterWorkbook({ gymId }, "last-month", now);
      const summary = sheets[0].rows.slice(1).map((r) => ({ measure: String(r.measure), value: formatValue(String(r.measure), r.value) }));
      const workbook = await toXlsx(sheets, { title: `S&C report, ${monthName}` });
      const title = `Your ${monthName} report`;
      const body = `Last month's figures for your gym are attached as one spreadsheet (a Summary sheet plus members, memberships, classes, bookings and app access).`;
      createNotification({
        id: randomUUID(),
        userId: user.id,
        type: "monthly_report",
        title,
        body: `${body} You can also download it from Staff > Exports.`,
        readAt: null,
        linkHref: "/staff/exports?range=last-month",
        dedupeKey,
        createdAt: now.toISOString(),
      });
      await sendEmail({
        to: user.email,
        subject: `S&C monthly report: ${monthName}`,
        text: `${body}\n\n${summary.map((s) => `${s.measure}: ${s.value}`).join("\n")}\n\nYou can also download it any time from Staff > Exports.`,
        html: `<p>${escape(body)}</p><table cellpadding="6" style="border-collapse:collapse">${summary
          .map((s) => `<tr><td style="color:#555">${escape(s.measure)}</td><td style="font-weight:600;text-align:right">${escape(s.value)}</td></tr>`)
          .join("")}</table><p style="color:#555">You can also download it any time from Staff &gt; Exports.</p>`,
        attachments: [{ filename: `sc-report-${month}.xlsx`, content: workbook.toString("base64") }],
      });
      sent++;
    }
    return `${monthName} report sent to ${sent} manager${sent === 1 ? "" : "s"}.`;
  },
};
