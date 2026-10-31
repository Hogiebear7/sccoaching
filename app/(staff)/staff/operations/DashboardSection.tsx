import Link from "next/link";

import { AreaTrend, Columns, MixRing } from "@/components/staff/admin/charts";
import { AdminIcon, type AdminIconName } from "@/components/staff/admin/icons";
import type { StaffDashboard } from "@/lib/staff-dashboard";
import type { MonthFigure, StaffToday } from "@/lib/staff-today";

// The top of the staff Overview (admin area v2, DESIGN.md "Admin area"). Reads top-down the way an owner works a day: what needs doing
// (to-dos), how the month is going (six figures against the same days last month), the trends behind them, today's classes, and the two
// lists to act on (members gone quiet, renewals coming up). Presentational: numbers come from lib/staff-today.ts and lib/staff-dashboard.ts,
// which share their rows with the spreadsheet exports.

const FIGURE_ICON: Record<string, AdminIconName> = {
  "Gym members": "members",
  "New sign-ups": "spark",
  "Memberships ended": "logout",
  Attendances: "attendance",
  "Class fill rate": "classes",
  "No-shows": "alert",
};

const TASK_ICON: Record<string, AdminIconName> = {
  messages: "messages",
  atRisk: "clock",
  renewals: "calendar",
  foodReviews: "food",
  bugReports: "bug",
};

function show(f: MonthFigure, v: number | null): string {
  if (v === null) return "—";
  return f.unit === "percent" ? `${Math.round(v * 100)}%` : v.toLocaleString("en-IE");
}

function Delta({ figure }: { figure: MonthFigure }) {
  if (figure.previous === null || figure.value === null || figure.better === "none") {
    return <span className="text-[13px] text-muted-foreground">{figure.note}</span>;
  }
  const diff = figure.value - figure.previous;
  const shown = figure.unit === "percent" ? `${Math.round(Math.abs(diff) * 100)} pts` : Math.abs(diff).toLocaleString("en-IE");
  const good = diff === 0 ? null : (diff > 0) === (figure.better === "up");
  const tone = good === null ? "bg-[#eef2f7] text-[#3e4c63]" : good ? "bg-[#e7f6ec] text-[#15803d]" : "bg-[#fdecec] text-[#b4232b]";
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums ${tone}`}>
        {diff === 0 ? null : <AdminIcon name={diff > 0 ? "arrow-up" : "arrow-down"} className="h-3.5 w-3.5" />}
        {diff === 0 ? "No change" : shown}
      </span>
      <span className="text-[13px] text-muted-foreground">vs same days last month</span>
      <span className="sr-only">({figure.note})</span>
    </span>
  );
}

function Card({ title, subtitle, action, children, className = "" }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel flex flex-col p-5 sm:p-6 ${className}`} aria-label={title}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold text-foreground">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-[#1d4ed8] hover:underline">
      {children}
      <AdminIcon name="chevron-right" className="h-3.5 w-3.5" />
    </Link>
  );
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

export function DashboardSection({ today, dashboard }: { today: StaffToday; dashboard: StaffDashboard }) {
  const atRisk = today.atRisk.slice(0, 6);
  const renewals = dashboard.renewals.slice(0, 6);
  const signupsTotal = dashboard.signupsByMonth.reduce((n, p) => n + p.value, 0);
  const checkinsTotal = dashboard.attendanceByWeek.reduce((n, p) => n + p.value, 0);

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[13px] font-medium text-muted-foreground">{dashboard.dateLabel}</p>
          <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[32px]">
            {dashboard.greeting}
            {dashboard.greetingName ? `, ${dashboard.greetingName}` : ""}
          </h1>
          <p className="mt-1 text-[15px] text-muted-foreground">Here&apos;s how the gym is doing in {today.monthLabel}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/staff/exports" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-[14px] font-medium text-foreground hover:bg-accent">
            <AdminIcon name="exports" className="h-4 w-4" />
            Spreadsheets
          </Link>
          <Link href="/staff/classes" className="btn-primary inline-flex h-10 items-center gap-2 px-4 text-[14px]">
            <AdminIcon name="classes" className="h-4 w-4" />
            Timetable
          </Link>
        </div>
      </div>

      {/* To-dos */}
      {dashboard.tasks.length > 0 ? (
        <section aria-labelledby="todo-heading">
          <h2 id="todo-heading" className="sr-only">
            To do
          </h2>
          <ul className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 2xl:grid-cols-5">
            {dashboard.tasks.map((t) => {
              const busy = t.count > 0;
              return (
                <li key={t.key}>
                  <Link
                    href={t.href}
                    className={`group flex h-full items-center gap-3 rounded-xl border p-3 transition-colors sm:p-4 ${
                      busy ? "border-[#ead9b6] bg-[#fbf6ec] hover:border-[#c6a15b]" : "border-[#e6eaf1] bg-[#ffffff] hover:border-[#c9d1dd]"
                    }`}
                  >
                    <span className={`hidden h-10 w-10 shrink-0 place-items-center rounded-lg min-[420px]:grid ${busy ? "bg-[#0a1526] text-[#c6a15b]" : "bg-[#eef2f7] text-[#5d6a80]"}`}>
                      <AdminIcon name={TASK_ICON[t.key]} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[22px] font-semibold leading-none tabular-nums text-foreground">{t.count}</span>
                      <span className="mt-1 block text-[13px] leading-snug text-muted-foreground">{t.label}</span>
                    </span>
                    <AdminIcon name="chevron-right" className="hidden h-4 w-4 shrink-0 text-[#8a96aa] transition-transform group-hover:translate-x-0.5 sm:block" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Month figures */}
      <section aria-labelledby="month-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="month-heading" className="text-[18px] font-semibold text-foreground">
            {today.monthLabel} so far
          </h2>
          <CardLink href="/staff/exports">Download as spreadsheets</CardLink>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {today.figures.map((f) => (
            <li key={f.label} className="panel p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[14px] font-medium text-muted-foreground">{f.label}</p>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#eef2f7] text-[#0a1526]">
                  <AdminIcon name={FIGURE_ICON[f.label] ?? "reports"} className="h-[18px] w-[18px]" />
                </span>
              </div>
              <p className="mt-1 text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">{show(f, f.value)}</p>
              <div className="mt-3">
                <Delta figure={f} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Trends */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          title="New sign-ups"
          subtitle={`Accounts created each month · ${signupsTotal} in six months`}
          className="xl:col-span-2"
          action={<CardLink href="/staff/members">Members</CardLink>}
        >
          <AreaTrend points={dashboard.signupsByMonth} unit="sign-ups" />
        </Card>
        <Card title="Membership mix" subtitle="What current gym members are on">
          {dashboard.planMix.length === 0 ? (
            <p className="text-sm text-muted-foreground">No current gym members yet.</p>
          ) : (
            <MixRing parts={dashboard.planMix} centreLabel="members" />
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          title="Class check-ins"
          subtitle={`Per week, last eight weeks · ${checkinsTotal} in total`}
          className="xl:col-span-2"
          action={<CardLink href="/staff/attendance">Attendance</CardLink>}
        >
          <Columns points={dashboard.attendanceByWeek} unit="check-ins" />
        </Card>
        <Card title="Today's classes" subtitle={dashboard.todayClasses.length ? `${dashboard.todayClasses.length} on the timetable` : undefined} action={<CardLink href="/staff/classes">Classes</CardLink>}>
          {dashboard.todayClasses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No classes on the timetable today.</p>
          ) : (
            <ul className="space-y-3">
              {dashboard.todayClasses.map((c) => {
                const pct = c.capacity ? Math.min(100, Math.round((c.booked / c.capacity) * 100)) : 0;
                const full = c.capacity > 0 && c.booked >= c.capacity;
                return (
                  <li key={c.id} className="flex gap-3">
                    <div className="w-14 shrink-0 rounded-lg bg-[#0a1526] py-2 text-center">
                      <p className="text-[14px] font-semibold tabular-nums text-[#ffffff]">{c.time}</p>
                      <p className="text-[11px] text-[#c6a15b]">{c.durationMins} min</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-[14px] font-semibold text-foreground">{c.title}</p>
                        <p className={`shrink-0 text-[13px] tabular-nums ${full ? "font-semibold text-[#b45309]" : "text-muted-foreground"}`}>
                          {c.booked}/{c.capacity}
                          {full ? " full" : ""}
                        </p>
                      </div>
                      <p className="truncate text-[13px] text-muted-foreground">{c.coach ?? "Coach not set"}</p>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#eef2f7]" aria-hidden="true">
                        <div className={`h-full rounded-full ${full ? "bg-[#c6a15b]" : "bg-[#0a1526]"}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* Lists to act on */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Gone quiet"
          subtitle={
            today.atRisk.length === 0
              ? "Every gym member has trained in the last two weeks"
              : `${today.atRisk.length} gym member${today.atRisk.length === 1 ? "" : "s"} with no class or logged session in 14 days`
          }
          action={today.atRisk.length > atRisk.length ? <CardLink href="/staff/attendance">See all</CardLink> : null}
        >
          {atRisk.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to chase.</p>
          ) : (
            <ul className="-mx-2">
              {atRisk.map((m) => (
                <li key={m.userId}>
                  <Link href={`/staff/members/${m.userId}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-[#f4f6fa]">
                    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#eef2f7] text-[12px] font-semibold text-[#0a1526]">
                      {initials(m.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-foreground">{m.name}</span>
                      <span className="block truncate text-[13px] text-muted-foreground">{m.plan ?? "No plan"}</span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums ${
                        m.daysSince === null ? "bg-[#eef2f7] text-[#3e4c63]" : m.daysSince > 28 ? "bg-[#fdecec] text-[#b4232b]" : "bg-[#fdf3e2] text-[#b45309]"
                      }`}
                    >
                      {m.daysSince === null ? "Not seen yet" : `${m.daysSince} days`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Renewals coming up"
          subtitle={dashboard.renewals.length === 0 ? "No paid periods end in the next 30 days" : `${dashboard.renewals.length} paid period${dashboard.renewals.length === 1 ? "" : "s"} end in the next 30 days`}
          action={<CardLink href="/staff/members">Members</CardLink>}
        >
          {renewals.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing due.</p>
          ) : (
            <ul className="-mx-2">
              {renewals.map((r) => (
                <li key={r.userId}>
                  <Link href={`/staff/members/${r.userId}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-[#f4f6fa]">
                    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#0a1526] text-[12px] font-semibold text-[#c6a15b]">
                      {initials(r.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-foreground">{r.name}</span>
                      <span className="block truncate text-[13px] text-muted-foreground">{r.plan ?? "No plan"}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[13px] font-semibold tabular-nums text-foreground">
                        {r.daysLeft === 0 ? "Today" : r.daysLeft === 1 ? "Tomorrow" : `In ${r.daysLeft} days`}
                      </span>
                      <span className="block text-[12px] tabular-nums text-muted-foreground">
                        {new Date(`${r.periodEnd}T00:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "UTC" })}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
