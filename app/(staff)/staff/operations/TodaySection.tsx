import Link from "next/link";

import type { MonthFigure, StaffToday } from "@/lib/staff-today";

// "This month" figures and the At-risk list at the top of the staff overview (admin revamp slice S2). Presentational only: the numbers come
// from lib/staff-today.ts, which shares its rows with the spreadsheet exports.

function show(f: MonthFigure, v: number | null): string {
  if (v === null) return "—";
  return f.unit === "percent" ? `${Math.round(v * 100)}%` : v.toLocaleString("en-IE");
}

function Change({ figure }: { figure: MonthFigure }) {
  if (figure.previous === null || figure.value === null || figure.better === "none") {
    return <span className="text-xs text-muted-foreground">{figure.note}</span>;
  }
  const diff = figure.value - figure.previous;
  const shown = figure.unit === "percent" ? `${Math.round(Math.abs(diff) * 100)} pts` : Math.abs(diff).toLocaleString("en-IE");
  const good = diff === 0 ? null : (diff > 0) === (figure.better === "up");
  const tone = good === null ? "text-muted-foreground" : good ? "text-emerald-400" : "text-amber-400";
  const arrow = diff === 0 ? "=" : diff > 0 ? "▲" : "▼";
  return (
    <span className={`text-xs ${tone}`}>
      <span aria-hidden="true">{arrow}</span> {diff === 0 ? "Same as" : `${shown} ${diff > 0 ? "more" : "fewer"} than`} last month
      <span className="sr-only"> ({figure.note})</span>
    </span>
  );
}

export function TodaySection({ today }: { today: StaffToday }) {
  const shownAtRisk = today.atRisk.slice(0, 8);
  return (
    <section aria-labelledby="this-month-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="this-month-heading" className="text-lg font-semibold">
          {today.monthLabel} so far
        </h3>
        <Link href="/staff/exports" className="text-xs text-gold transition hover:text-gold/80">
          Download as spreadsheets →
        </Link>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">Compared with the same days last month.</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {today.figures.map((f) => (
          <div key={f.label} className="panel rounded-2xl p-4">
            <p className="text-sm text-muted-foreground">{f.label}</p>
            <p className="mt-1 text-display text-[28px] leading-tight tabular-nums">{show(f, f.value)}</p>
            <div className="mt-1">
              <Change figure={f} />
            </div>
          </div>
        ))}
      </div>

      <div className="panel p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-base font-semibold">At risk</h4>
          <span className="text-xs text-muted-foreground">
            {today.atRisk.length === 0
              ? "Nobody right now"
              : `${today.atRisk.length} gym member${today.atRisk.length === 1 ? "" : "s"} with no class or logged session in 14 days`}
          </span>
        </div>
        {today.atRisk.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Every gym member has trained in the last two weeks.</p>
        ) : (
          <ul className="mt-3 divide-y divide-white/[0.06]">
            {shownAtRisk.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <Link href={`/staff/members/${m.userId}`} className="truncate text-sm font-medium text-foreground hover:text-gold">
                    {m.name}
                  </Link>
                  {m.plan ? <p className="truncate text-xs text-muted-foreground">{m.plan}</p> : null}
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {m.daysSince === null ? "No activity yet" : `${m.daysSince} days since last seen`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {today.atRisk.length > shownAtRisk.length ? (
          <p className="mt-2 text-xs text-muted-foreground">
            And {today.atRisk.length - shownAtRisk.length} more: the full list is in the Members sheet of the{" "}
            <Link href="/staff/exports" className="text-gold hover:text-gold/80">
              exports
            </Link>
            .
          </p>
        ) : null}
      </div>
    </section>
  );
}
