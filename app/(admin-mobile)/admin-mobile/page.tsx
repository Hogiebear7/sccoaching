import Link from "next/link";
import { classes, members, messages, kpiSnapshot } from "@/lib/mock-data";

const today = "2026-06-11";
const todayClasses = classes.filter((c) => c.date === today);
const totalEnrolledToday = todayClasses.reduce((s, c) => s + c.enrolled, 0);
const unreadCount = messages.filter((m) => !m.read && m.toId === "coach").length;
const nextClass = todayClasses[todayClasses.length > 1 ? 1 : 0];

export default function AdminMobileOverview() {
  return (
    <div className="px-4 pt-6 pb-4 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-500">Coach Dashboard</p>
          <h1 className="text-2xl font-bold text-zinc-50">Good morning, Sarah</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Thu, Jun 11</p>
        </div>
        <div className="w-10 h-10 rounded-full bg-teal-600 flex items-center justify-center text-sm font-bold text-white">SO</div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-3 text-center">
          <p className="text-xl font-bold text-zinc-50">{todayClasses.length}</p>
          <p className="text-[10px] text-zinc-500">Classes today</p>
        </div>
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-3 text-center">
          <p className="text-xl font-bold text-teal-400">{totalEnrolledToday}</p>
          <p className="text-[10px] text-zinc-500">Bookings</p>
        </div>
        <Link href="/admin-mobile/inbox">
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-3 text-center relative">
            <p className="text-xl font-bold text-zinc-50">{unreadCount}</p>
            <p className="text-[10px] text-zinc-500">Unread msgs</p>
            {unreadCount > 0 && <div className="absolute top-2 right-2 w-2 h-2 bg-teal-400 rounded-full" />}
          </div>
        </Link>
      </div>

      {/* Next class */}
      {nextClass && (
        <div>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Up Next</h2>
          <div className="bg-teal-600/10 border border-teal-600/30 rounded-2xl p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-teal-600/20 flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6 text-teal-400">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-zinc-100">{nextClass.name}</p>
              <p className="text-sm text-zinc-400">{nextClass.time} · {nextClass.durationMins}min</p>
              <p className="text-xs text-teal-400 mt-0.5">{nextClass.enrolled}/{nextClass.capacity} enrolled</p>
            </div>
          </div>
        </div>
      )}

      {/* Today's full schedule */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Today's Schedule</h2>
          <Link href="/admin-mobile/schedule" className="text-xs text-teal-400 font-medium">See all</Link>
        </div>
        <div className="flex flex-col gap-2">
          {todayClasses.map((cls) => (
            <div key={cls.id} className="bg-zinc-900 rounded-xl border border-zinc-800 px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-100">{cls.name}</p>
                <p className="text-xs text-zinc-500">{cls.time}</p>
              </div>
              <span className="text-sm font-bold text-zinc-300">{cls.enrolled}<span className="text-zinc-600 font-normal text-xs">/{cls.capacity}</span></span>
            </div>
          ))}
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/admin-mobile/members" className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-2 hover:border-zinc-700 transition-colors">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6 text-teal-400">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <p className="text-sm font-semibold text-zinc-100">{kpiSnapshot.activeMembersTotal} Members</p>
          <p className="text-xs text-zinc-500">View all members</p>
        </Link>
        <Link href="/admin-mobile/inbox" className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-2 hover:border-zinc-700 transition-colors">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6 text-violet-400">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <p className="text-sm font-semibold text-zinc-100">{unreadCount} Unread</p>
          <p className="text-xs text-zinc-500">Open inbox</p>
        </Link>
      </div>
    </div>
  );
}
