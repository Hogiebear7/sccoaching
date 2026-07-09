import Link from "next/link";
import { classes, members, messages, kpiSnapshot } from "@/lib/mock-data";

const today = "2026-06-11";
const todayClasses = classes.filter((c) => c.date === today);
const totalEnrolledToday = todayClasses.reduce((s, c) => s + c.enrolled, 0);
const unreadCount = messages.filter((m) => !m.read && m.toId === "coach").length;
const nextClass = todayClasses[todayClasses.length > 1 ? 1 : 0];

export default function AdminMobileOverview() {
  return (
    <div className="anim-rise flex flex-col gap-6 pb-4">
      {/* Immersive header */}
      <header className="relative overflow-hidden border-b border-white/[0.06] px-4 pb-6 pt-8">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-teal-950/70 via-teal-950/25 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(85%_100%_at_50%_0%,rgba(45,212,191,0.14),transparent)]" />
        <div className="relative">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-teal-200/70">Coach Dashboard · Thu, Jun 11</p>
              <h1 className="text-display mt-1 text-[28px] leading-tight text-zinc-50">Good morning, Sarah</h1>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-b from-teal-500 to-teal-600 text-sm font-semibold text-white ring-1 ring-white/20 shadow-[0_2px_8px_rgba(0,0,0,0.4)]">SO</div>
          </div>

          {/* Quick stats — frosted inset strip */}
          <div className="mt-6 grid grid-cols-3 divide-x divide-white/[0.07] rounded-2xl border border-white/[0.1] bg-white/[0.05] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] backdrop-blur-md">
            <div className="flex flex-col items-center gap-1 px-2 py-3.5">
              <p className="text-display text-[22px] leading-none text-zinc-50 tabular-nums">{todayClasses.length}</p>
              <p className="text-[10px] text-zinc-400">Classes today</p>
            </div>
            <div className="flex flex-col items-center gap-1 px-2 py-3.5">
              <p className="text-display text-[22px] leading-none text-teal-300 tabular-nums">{totalEnrolledToday}</p>
              <p className="text-[10px] text-zinc-400">Bookings</p>
            </div>
            <Link href="/admin-mobile/inbox" className="relative flex flex-col items-center gap-1 px-2 py-3.5">
              <p className="text-display text-[22px] leading-none text-zinc-50 tabular-nums">{unreadCount}</p>
              <p className="text-[10px] text-zinc-400">Unread msgs</p>
              {unreadCount > 0 && <div className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-teal-400" />}
            </Link>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-5 px-4">

      {/* Next class — hero card */}
      {nextClass && (
        <div>
          <h2 className="label-caps mb-2.5">Up Next</h2>
          <div className="panel overflow-hidden">
            <div className="flex items-stretch">
              <div className="flex w-[88px] flex-shrink-0 flex-col items-center justify-center gap-0.5 border-r border-white/[0.06] bg-white/[0.02] py-6">
                <span className="text-display text-[24px] leading-none text-zinc-50 tabular-nums">{nextClass.time.split(":")[0]}</span>
                <span className="text-[13px] leading-none text-zinc-500 tabular-nums">:{nextClass.time.split(":")[1]}</span>
              </div>
              <div className="min-w-0 flex-1 p-4">
                <p className="text-display text-[17px] leading-tight text-zinc-50">{nextClass.name}</p>
                <p className="mt-1 text-[13px] text-zinc-400 tabular-nums">{nextClass.durationMins} min</p>
                <div className="mt-3 flex items-center gap-2.5">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full bg-teal-400/80" style={{ width: `${Math.round((nextClass.enrolled / nextClass.capacity) * 100)}%` }} />
                  </div>
                  <span className="text-[11px] text-zinc-500 tabular-nums">{nextClass.enrolled}/{nextClass.capacity}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Today's full schedule */}
      <div>
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="label-caps">Today&apos;s Schedule</h2>
          <Link href="/admin-mobile/schedule" className="text-xs font-medium text-blue-400 transition-colors duration-150 hover:text-blue-300">See all →</Link>
        </div>
        <div className="panel divide-y divide-white/[0.05] overflow-hidden">
          {todayClasses.map((cls) => (
            <div key={cls.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-display w-12 text-[13px] text-zinc-400 tabular-nums">{cls.time}</span>
                <p className="text-sm font-medium text-zinc-100">{cls.name}</p>
              </div>
              <span className="text-sm font-semibold text-zinc-300 tabular-nums">{cls.enrolled}<span className="text-xs font-normal text-zinc-600">/{cls.capacity}</span></span>
            </div>
          ))}
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-2.5">
        <Link href="/admin-mobile/members" className="panel hover-lift flex flex-col gap-3 p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-teal-500/20 bg-teal-500/10">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5 text-teal-300">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div>
            <p className="text-[13px] font-semibold leading-tight tracking-tight text-zinc-100">{kpiSnapshot.activeMembersTotal} Members</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">View all members</p>
          </div>
        </Link>
        <Link href="/admin-mobile/inbox" className="panel hover-lift flex flex-col gap-3 p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-500/20 bg-violet-500/10">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5 text-violet-300">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div>
            <p className="text-[13px] font-semibold leading-tight tracking-tight text-zinc-100">{unreadCount} Unread</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">Open inbox</p>
          </div>
        </Link>
      </div>
      </div>
    </div>
  );
}
