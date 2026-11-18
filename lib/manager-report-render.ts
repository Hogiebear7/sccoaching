// Turns a ManagerReport into an email (plain text and HTML). Pure formatting: no datastore access and no arithmetic beyond display rounding. The staff page
// (app/(staff)/staff/briefings) shows the same report from the same object, so the email and the page always agree.

import type { Comparison, ManagerReport, MoneySummary } from "@/lib/manager-report-shared";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const eur = (cents: number) => `${cents < 0 ? "-" : ""}€${(Math.abs(cents) / 100).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const eurAmount = (euros: number | null) => (euros === null ? "n/a" : `€${euros.toFixed(2)}`);
const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);

/** " (up 12% on last week)" or "" when there is nothing to compare. */
export function comparisonText(c: Comparison, cadence: "weekly" | "monthly"): string {
  if (c.changePercent === null) return "";
  const when = cadence === "weekly" ? "last week" : "last month";
  if (c.changePercent === 0) return ` (same as ${when})`;
  return ` (${c.changePercent > 0 ? "up" : "down"} ${Math.abs(c.changePercent)}% on ${when})`;
}

export function reportSubject(report: ManagerReport): string {
  return `${report.cadence === "weekly" ? "Weekly" : "Monthly"} briefing, ${report.gymName}: ${report.period.label}`;
}

interface Line {
  label: string;
  value: string;
}
interface Block {
  title: string;
  lines: Line[];
  /** Plain bullet lines under the figures (for example the per-type breakdown). */
  bullets?: string[];
}

function moneyLines(m: MoneySummary): Line[] {
  return [
    { label: "Income", value: eur(m.incomeCents) },
    { label: "Fees", value: eur(m.feesCents) },
    { label: "Expenses entered", value: eur(m.expensesCents) },
  ];
}

/** The report as a list of titled blocks, shared by the text and HTML renderers. */
export function reportBlocks(report: ManagerReport): Block[] {
  const { gym, money, app, platform, cadence } = report;
  const blocks: Block[] = [];

  blocks.push({
    title: "Classes",
    lines: [
      { label: "Booked in", value: `${gym.bookings.total}${comparisonText(gym.bookings.comparison, cadence)}` },
      { label: "Attended", value: String(gym.bookings.attended) },
      { label: "No-shows", value: String(gym.bookings.noShows) },
      { label: "Classes run", value: String(gym.bookings.classes) },
      { label: "Average fill rate", value: pct(gym.bookings.fillRate) },
    ],
    bullets: [
      ...gym.bookings.byType.map((t) => `${t.label}: ${t.bookingCount} booked, ${t.attendedCount} attended, ${t.classCount} class${t.classCount === 1 ? "" : "es"}`),
      ...(gym.bookings.busiestHours.length ? [`Busiest hours: ${gym.bookings.busiestHours.map((h) => `${h.label} (${h.bookings})`).join("; ")}`] : []),
    ],
  });

  blocks.push({
    title: "Members",
    lines: [
      { label: "Total members", value: String(gym.members.total) },
      { label: "Current / paused", value: `${gym.members.current} / ${gym.members.paused}` },
      { label: "Pass holders", value: String(gym.members.passHolders) },
      { label: "New sign-ups", value: `${gym.members.newSignups}${comparisonText(gym.members.newSignupsComparison, cadence)}` },
      { label: "Class passes bought", value: String(gym.members.passesBought) },
      { label: "Memberships ended", value: `${gym.members.lost}${comparisonText(gym.members.lostComparison, cadence)}` },
      { label: "Gone quiet (14 days+, now)", value: String(gym.members.quiet) },
    ],
  });

  if (money) {
    blocks.push({
      title: "Gym money",
      lines: [
        ...moneyLines(money).slice(0, 1).map((l) => ({ ...l, value: `${l.value}${comparisonText(money.incomeComparison, cadence)}` })),
        ...moneyLines(money).slice(1),
        { label: "AI cost", value: `${eurAmount(money.ai.costEur)} (${money.ai.calls} calls)` },
        { label: "AI average", value: `${eurAmount(money.ai.avgPerCallEur)} per call, ${eurAmount(money.ai.avgPerUserEur)} per member` },
        { label: "Balance", value: eur(money.balanceCents) },
        { label: `Tax set aside (${money.taxRatePercent}%)`, value: eur(money.taxSetAsideCents) },
      ],
      bullets: [...money.byType.map((t) => `${t.label}: ${eur(t.amountCents)} (${t.count})`), ...money.bySource.map((t) => `Via ${t.label}: ${eur(t.amountCents)}`)],
    });
  }

  if (app) {
    blocks.push({
      title: "App only",
      lines: [
        { label: "Total users", value: String(app.totalUsers) },
        { label: "App Subscription holders", value: `${app.subscribers.total} (Apple ${app.subscribers.appStore}, Google ${app.subscribers.googlePlay}, complimentary ${app.subscribers.complimentary})` },
        {
          label: "Downloads",
          value:
            app.downloads.month === null
              ? "monthly report only"
              : app.downloads.appStore === null && app.downloads.googlePlay === null
                ? "not entered yet"
                : `Apple ${app.downloads.appStore ?? "n/a"}, Google ${app.downloads.googlePlay ?? "n/a"}${app.downloads.appStore !== null && app.downloads.googlePlay !== null ? ` (${app.downloads.appStore + app.downloads.googlePlay} in all)` : ""}`,
        },
        { label: "Trials started / ended without converting", value: `${app.trialsStarted ?? "n/a"} / ${app.trialsEndedWithoutConverting}` },
        { label: "Income", value: app.money.incomeLineCount > 0 ? eur(app.money.incomeCents) : "none recorded" },
        { label: "Apple and Google cut", value: eur(app.money.feesCents) },
        { label: "AI cost", value: `${eurAmount(app.ai.costEur)} (${app.ai.calls} calls)` },
        { label: "AI average", value: `${eurAmount(app.ai.avgPerCallEur)} per call, ${eurAmount(app.ai.avgPerUserEur)} per user` },
        { label: "Balance", value: eur(app.money.balanceCents) },
        { label: `Tax set aside (${app.money.taxRatePercent}%)`, value: eur(app.money.taxSetAsideCents) },
      ],
      bullets: app.plansBought.length ? app.plansBought.map((p) => `Bought: ${p.label} × ${p.count}`) : ["No new subscriptions bought."],
    });
  }

  if (platform && platform.length > 0) {
    blocks.push({
      title: "Gyms on the platform",
      lines: [],
      bullets: platform.map((g) => `${g.name}: ${g.members} members, ${g.newSignups} new, ${g.bookings} bookings, ${g.classes} classes`),
    });
  }
  return blocks;
}

export function reportToText(report: ManagerReport, staffUrl?: string): string {
  const out: string[] = [reportSubject(report), ""];
  out.push("THINGS TO LOOK AT");
  out.push(...(report.attention.length ? report.attention.map((a) => `- ${a.text}`) : ["- Nothing stands out."]));
  for (const b of reportBlocks(report)) {
    out.push("", b.title.toUpperCase());
    out.push(...b.lines.map((l) => `${l.label}: ${l.value}`));
    if (b.bullets?.length) out.push(...b.bullets.map((x) => `- ${x}`));
  }
  out.push("", "NOTES", ...report.notes.map((n) => `- ${n}`));
  if (staffUrl) out.push("", `Full report: ${staffUrl}`);
  return out.join("\n");
}

export function reportToHtml(report: ManagerReport, staffUrl?: string): string {
  const navy = "#0b1730";
  const gold = "#c9a24b";
  const blocks = reportBlocks(report)
    .map((b) => {
      const rows = b.lines.map((l) => `<tr><td style="padding:4px 12px 4px 0;color:#555">${escape(l.label)}</td><td style="padding:4px 0;font-weight:600;text-align:right">${escape(l.value)}</td></tr>`).join("");
      const bullets = b.bullets?.length ? `<ul style="margin:6px 0 0 18px;padding:0;color:#333">${b.bullets.map((x) => `<li>${escape(x)}</li>`).join("")}</ul>` : "";
      return `<h3 style="margin:22px 0 6px;font-size:15px;color:${navy};border-bottom:2px solid ${gold};padding-bottom:4px">${escape(b.title)}</h3>${rows ? `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">${rows}</table>` : ""}${bullets}`;
    })
    .join("");
  const attention = report.attention.length
    ? `<ul style="margin:6px 0 0 18px;padding:0">${report.attention.map((a) => `<li style="margin:3px 0;${a.level === "watch" ? "font-weight:600" : ""}">${escape(a.text)}</li>`).join("")}</ul>`
    : `<p style="margin:6px 0 0;color:#555">Nothing stands out.</p>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111;line-height:1.45">
<h2 style="margin:0 0 2px;color:${navy}">${report.cadence === "weekly" ? "Weekly" : "Monthly"} briefing</h2>
<p style="margin:0;color:#555">${escape(report.gymName)} · ${escape(report.period.label)}</p>
<h3 style="margin:22px 0 6px;font-size:15px;color:${navy};border-bottom:2px solid ${gold};padding-bottom:4px">Things to look at</h3>${attention}
${blocks}
<h3 style="margin:22px 0 6px;font-size:15px;color:${navy};border-bottom:2px solid ${gold};padding-bottom:4px">Notes</h3>
<ul style="margin:6px 0 0 18px;padding:0;color:#555;font-size:13px">${report.notes.map((n) => `<li>${escape(n)}</li>`).join("")}</ul>
${staffUrl ? `<p style="margin:22px 0 0"><a href="${escape(staffUrl)}" style="color:${navy};font-weight:600">Open the full report</a></p>` : ""}
</div>`;
}
