import Link from "next/link";
import TopBar from "@/components/admin/TopBar";
import MetricCard from "@/components/admin/MetricCard";
import { kpiSnapshot, members, classes } from "@/lib/mock-data";

const recentCheckins = [...members]
  .filter((m) => m.status === "Active")
  .sort((a, b) => b.lastVisit.localeCompare(a.lastVisit))
  .slice(0, 6);

const todayClasses = classes.filter((c) => c.date === "2026-06-11").slice(0, 4);

export default function AdminOverview() {
  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar title="Overview" subtitle="Thu, June 11 2026" />
      <div className="flex-1 overflow-y-auto p-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          <MetricCard label="Active Members" value={kpiSnapshot.activeMembersTotal} sub="total enrolled" trend={5.2}
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>}
          />
          <MetricCard label="MTD Revenue" value={`$${kpiSnapshot.mtdRevenue.toLocaleString()}`} sub="Jun 2026" trend={8.1}
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>}
          />
          <MetricCard label="New Sign-ups" value={kpiSnapshot.newSignUpsThisMonth} sub="this month" trend={-12.5}
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>}
          />
          <MetricCard label="Avg Visits/Week" value={kpiSnapshot.avgVisitsPerWeek} sub="per active member" trend={3.6}
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12" /></svg>}
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Recent check-ins */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-zinc-300">Recent Activity</h2>
              <Link href="/admin/members" className="text-xs text-teal-500 hover:text-teal-400">View all</Link>
            </div>
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 divide-y divide-zinc-800">
              {recentCheckins.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-300 flex-shrink-0">{m.initials}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-100">{m.name}</p>
                    <p className="text-xs text-zinc-500">{m.tier} · {m.totalVisits} visits</p>
                  </div>
                  <span className="text-xs text-zinc-600">
                    {m.lastVisit === "2026-06-11" ? "Today" : m.lastVisit === "2026-06-10" ? "Yesterday" : m.lastVisit}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Today's classes */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-zinc-300">Today's Classes</h2>
              <span className="text-xs text-zinc-500">{todayClasses.length} scheduled</span>
            </div>
            <div className="flex flex-col gap-2">
              {todayClasses.map((cls) => {
                const pct = Math.round((cls.enrolled / cls.capacity) * 100);
                return (
                  <div key={cls.id} className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-semibold text-zinc-100">{cls.name}</p>
                        <p className="text-xs text-zinc-500">{cls.time} · {cls.durationMins}min</p>
                      </div>
                      <p className="text-sm font-bold text-zinc-50">{cls.enrolled}<span className="text-zinc-600 font-normal">/{cls.capacity}</span></p>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${pct >= 90 ? "bg-orange-500" : "bg-teal-600"}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
