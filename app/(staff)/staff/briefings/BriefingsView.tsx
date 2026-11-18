import Link from "next/link";

import { reportBlocks } from "@/lib/manager-report-render";
import { StoreDownloadsForm } from "./StoreDownloadsForm";
import type { ManagerReport } from "@/lib/manager-report-shared";

const pill = (active: boolean) =>
  `rounded-full px-3 py-1.5 text-xs font-semibold transition ${active ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`;

export function BriefingsView({ report, offset, maxOffset }: { report: ManagerReport; offset: number; maxOffset: number }) {
  const { cadence } = report;
  const href = (c: string, p: number) => `/staff/briefings?cadence=${c}&p=${p}`;
  const blocks = reportBlocks(report);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-display mt-1 text-[28px] leading-tight">Briefings</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          The weekly check-in and the monthly report for {report.gymName}, worked out from your records the same way every time. The same report is emailed to you
          on Monday mornings and from the 5th of each month. Nothing here changes anything.
        </p>
      </div>

      <div className="panel flex flex-wrap items-center gap-2 p-4">
        <Link href={href("weekly", 0)} className={pill(cadence === "weekly")}>Weekly</Link>
        <Link href={href("monthly", 0)} className={pill(cadence === "monthly")}>Monthly</Link>
        <span className="mx-2 text-xs text-muted-foreground">·</span>
        {offset < maxOffset ? <Link href={href(cadence, offset + 1)} className={pill(false)}>Earlier</Link> : null}
        {offset > 0 ? <Link href={href(cadence, offset - 1)} className={pill(false)}>Later</Link> : null}
        {offset > 0 ? <Link href={href(cadence, 0)} className={pill(false)}>Latest</Link> : null}
        <span className="ml-auto text-sm font-medium">{report.period.label}</span>
      </div>

      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Things to look at</h3>
        {report.attention.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing stands out this period.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {report.attention.map((a, i) => (
              <li key={i} className="well flex items-start justify-between gap-3 p-3 text-sm">
                <span className={a.level === "watch" ? "font-semibold" : ""}>{a.text}</span>
                {a.href ? (
                  <Link href={a.href} className="shrink-0 text-xs font-semibold text-teal-700 hover:underline">
                    Open
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {blocks.map((b) => (
        <div key={b.title} className="panel p-6">
          <h3 className="text-lg font-semibold">{b.title}</h3>
          {b.lines.length > 0 ? (
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {b.lines.map((l) => (
                <div key={l.label} className="well flex items-baseline justify-between gap-3 p-3">
                  <dt className="text-xs text-muted-foreground">{l.label}</dt>
                  <dd className="text-sm font-semibold tabular-nums">{l.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {b.bullets?.length ? (
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              {b.bullets.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          ) : null}
          {b.title === "App only" && report.app && report.app.downloads.month !== null ? (
            <StoreDownloadsForm month={report.app.downloads.month} label={report.period.label} appStore={report.app.downloads.appStore} googlePlay={report.app.downloads.googlePlay} />
          ) : null}
          {b.title === "Members" && report.gym.members.quietNames.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Longest gone quiet: {report.gym.members.quietNames.map((q) => `${q.name}${q.daysSince !== null ? ` (${q.daysSince} days)` : ""}`).join(", ")}.
            </p>
          ) : null}
        </div>
      ))}

      <div className="panel p-6">
        <h3 className="text-lg font-semibold">About these figures</h3>
        <ul className="mt-3 space-y-1 text-xs leading-relaxed text-muted-foreground">
          {report.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
