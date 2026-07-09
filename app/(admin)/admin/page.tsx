import Link from "next/link";
import TopBar from "@/components/admin/TopBar";
import { kpiSnapshot, members, classes, monthlyReports } from "@/lib/mock-data";

const recentCheckins = [...members]
  .filter((m) => m.status === "Active")
  .sort((a, b) => b.lastVisit.localeCompare(a.lastVisit))
  .slice(0, 6);

const todayClasses = classes.filter((c) => c.date === "2026-06-11").slice(0, 4);

const maxRevenue = Math.max(...monthlyReports.map((r) => r.revenue));

function TrendChip({ trend }: { trend: number }) {
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${trend >= 0 ? "bg-teal-500/10 text-teal-400" : "bg-red-500/10 text-red-400"}`}>
      {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}%
    </span>
  );
}

export default function AdminOverview() {
  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar
        title="Overview"
        subtitle="Thu, June 11 2026"
        action={
          <Link
            href="/admin/reports"
            className="rounded-[10px] border border-white/[0.1] bg-white/[0.04] px-4 py-2 text-[13px] font-medium text-zinc-200 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] transition-colors duration-150 hover:border-white/[0.16] hover:bg-white/[0.07]"
          >
            View reports →
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="anim-rise mx-auto max-w-6xl">
          {/* Row 1 — dominant revenue panel + KPI stack */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="panel relative overflow-hidden p-7 xl:col-span-8">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(60%_100%_at_30%_0%,rgba(45,212,191,0.07),transparent)]" />
              <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="label-caps">MTD Revenue</p>
                  <p className="text-display mt-3 text-[44px] leading-none text-zinc-50 tabular-nums">
                    ${kpiSnapshot.mtdRevenue.toLocaleString()}
                  </p>
                  <div className="mt-3 flex items-center gap-1.5">
                    <TrendChip trend={8.1} />
                    <span className="text-xs text-zinc-600">vs last month · Jun 2026</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="label-caps">Best Month</p>
                  <p className="text-display mt-2 text-lg text-zinc-200 tabular-nums">
                    ${maxRevenue.toLocaleString()}
                  </p>
                </div>
              </div>
              {/* 12-month revenue rhythm */}
              <div className="relative mt-8 flex h-24 items-end gap-1.5">
                {monthlyReports.map((r, i) => {
                  const isLast = i === monthlyReports.length - 1;
                  return (
                    <div key={r.month} className="group flex flex-1 flex-col items-center gap-1.5" title={`${r.month}: $${r.revenue.toLocaleString()}`}>
                      <div className="relative w-full flex-1">
                        <div
                          className={`absolute bottom-0 w-full rounded-t transition-colors duration-150 ${isLast ? "bg-blue-400" : "bg-white/[0.08] group-hover:bg-white/[0.14]"}`}
                          style={{ height: `${(r.revenue / maxRevenue) * 100}%` }}
                        />
                      </div>
                      <span className={`text-[9px] tabular-nums ${isLast ? "font-semibold text-blue-300" : "text-zinc-600"}`}>{r.month.slice(0, 3)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* KPI stack */}
            <div className="panel flex flex-col justify-between divide-y divide-white/[0.06] xl:col-span-4">
              {[
                { label: "Active Members", value: kpiSnapshot.activeMembersTotal, sub: "total enrolled", trend: 5.2 },
                { label: "New Sign-ups", value: kpiSnapshot.newSignUpsThisMonth, sub: "this month", trend: -12.5 },
                { label: "Avg Visits / Week", value: kpiSnapshot.avgVisitsPerWeek, sub: "per active member", trend: 3.6 },
              ].map((kpi) => (
                <div key={kpi.label} className="flex flex-1 items-center justify-between gap-4 px-6 py-5">
                  <div>
                    <p className="label-caps">{kpi.label}</p>
                    <p className="mt-1 text-xs text-zinc-600">{kpi.sub}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <p className="text-display text-[26px] leading-none text-zinc-50 tabular-nums">{kpi.value}</p>
                    <TrendChip trend={kpi.trend} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Row 2 — activity ledger + today's classes */}
          <div className="mt-10 grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="xl:col-span-7">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-display text-[15px] text-zinc-200">Recent Activity</h2>
                <Link href="/admin/members" className="text-xs font-medium text-blue-400 transition-colors duration-150 hover:text-blue-300">View all →</Link>
              </div>
              <div className="panel divide-y divide-white/[0.05] overflow-hidden">
                {recentCheckins.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-5 py-3 transition-colors duration-150 hover:bg-white/[0.02]">
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[11px] font-semibold text-zinc-300 ring-1 ring-white/10">{m.initials}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-tight text-zinc-100">{m.name}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">{m.tier} · {m.totalVisits} visits</p>
                    </div>
                    <span className="text-xs text-zinc-600 tabular-nums">
                      {m.lastVisit === "2026-06-11" ? "Today" : m.lastVisit === "2026-06-10" ? "Yesterday" : m.lastVisit}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="xl:col-span-5">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-display text-[15px] text-zinc-200">Today&apos;s Classes</h2>
                <span className="text-xs text-zinc-500 tabular-nums">{todayClasses.length} scheduled</span>
              </div>
              <div className="panel divide-y divide-white/[0.05] overflow-hidden">
                {todayClasses.map((cls) => {
                  const pct = Math.round((cls.enrolled / cls.capacity) * 100);
                  return (
                    <div key={cls.id} className="flex items-center gap-4 px-5 py-4">
                      <div className="flex h-11 w-12 flex-shrink-0 flex-col items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.03]">
                        <span className="text-display text-[15px] leading-none text-zinc-100 tabular-nums">{cls.time.split(":")[0]}</span>
                        <span className="mt-0.5 text-[9px] leading-none text-zinc-500 tabular-nums">:{cls.time.split(":")[1]}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm font-semibold leading-tight tracking-tight text-zinc-100">{cls.name}</p>
                          <p className="flex-shrink-0 text-sm font-semibold text-zinc-50 tabular-nums">{cls.enrolled}<span className="font-normal text-zinc-600">/{cls.capacity}</span></p>
                        </div>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                          <div className={`h-full rounded-full ${pct >= 90 ? "bg-orange-500/90" : "bg-teal-400/80"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
