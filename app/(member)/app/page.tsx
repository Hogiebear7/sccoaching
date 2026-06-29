import Link from "next/link";
import { classes, currentMember, workoutSessions } from "@/lib/mock-data";
import Card from "@/components/ui/Card";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function AppDashboard() {
  const member = currentMember;
  const today = "2026-06-11";

  const todayClasses = classes.filter((c) => c.date === today).slice(0, 2);
  const nextClass = todayClasses[0];

  const memberSessions = workoutSessions.filter((s) => s.memberId === member.id);
  const thisMonthSessions = memberSessions.filter((s) => s.date.startsWith("2026-06"));
  const lastSession = [...memberSessions].sort((a, b) => b.date.localeCompare(a.date))[0];

  return (
    <div className="px-4 pt-6 pb-4 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-500">{greeting()},</p>
          <h1 className="text-2xl font-bold text-zinc-50">{member.name.split(" ")[0]} 👋</h1>
        </div>
        <Link href="/app/profile">
          <div className="w-10 h-10 rounded-full bg-teal-600 flex items-center justify-center text-sm font-bold text-white">
            {member.initials}
          </div>
        </Link>
      </div>

      {/* Streak + quick stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-3 flex flex-col items-center gap-1">
          <p className="text-xl font-bold text-teal-400">{member.streak}</p>
          <p className="text-[10px] text-zinc-500 text-center">day streak</p>
        </div>
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-3 flex flex-col items-center gap-1">
          <p className="text-xl font-bold text-zinc-100">{thisMonthSessions.length}</p>
          <p className="text-[10px] text-zinc-500 text-center">sessions Jun</p>
        </div>
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-3 flex flex-col items-center gap-1">
          <p className="text-xl font-bold text-zinc-100">{member.totalVisits}</p>
          <p className="text-[10px] text-zinc-500 text-center">total visits</p>
        </div>
      </div>

      {/* Today's session */}
      {nextClass ? (
        <div>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Next Class Today</h2>
          <Card className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-teal-600/20 flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6 text-teal-400">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-zinc-100">{nextClass.name}</p>
              <p className="text-sm text-zinc-500">{nextClass.time} · {nextClass.durationMins}min · {nextClass.coachName}</p>
              <p className="text-xs text-zinc-600 mt-0.5">{nextClass.enrolled}/{nextClass.capacity} enrolled</p>
            </div>
            <Link href="/app/schedule" className="text-xs text-teal-400 font-medium hover:text-teal-300">View</Link>
          </Card>
        </div>
      ) : (
        <div>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Today</h2>
          <Card className="p-4 text-center">
            <p className="text-sm text-zinc-400">No classes scheduled today.</p>
            <Link href="/app/workouts" className="text-sm text-teal-400 font-medium block mt-2">Log a solo workout →</Link>
          </Card>
        </div>
      )}
      {/* Ask Coach AI */}
      <div>
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Coach</h2>
        <Card className="p-0 overflow-hidden">
          <div className="flex items-center gap-3 p-4">
            <div className="w-12 h-12 rounded-2xl bg-teal-600/15 flex items-center justify-center flex-shrink-0">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-6 h-6 text-teal-400"
              >
                <path d="M12 3a7 7 0 0 0-7 7c0 2.1.93 4.09 2.54 5.43V19a2 2 0 0 0 2 2h4.92a2 2 0 0 0 2-2v-3.57A7 7 0 0 0 19 10a7 7 0 0 0-7-7z" />
                <path d="M9.5 21h5" />
              </svg>
            </div>

            <div className="flex-1 min-w-0">
              <Link
                href="/app/coach"
                className="text-sm font-semibold text-zinc-100 hover:text-teal-300 focus:outline-none focus:text-teal-300"
              >
                Ask Coach AI
              </Link>
              <p className="text-xs text-zinc-500 mt-0.5">
                Training, recovery, cycle & nutrition guidance
              </p>
            </div>

            <Link
              href="/app/coach"
              aria-label="Open AI Coach"
              className="text-zinc-500 hover:text-zinc-300 flex items-center justify-center"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="w-5 h-5"
              >
                <polyline points="9,18 15,12 9,6" />
              </svg>
            </Link>
          </div>
        </Card>
      </div>
      {/* Last workout */}
      {lastSession && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Last Workout</h2>
            <Link href="/app/workouts" className="text-xs text-teal-400 font-medium">View all</Link>
          </div>
          <Card className="p-4">
            <p className="text-sm font-semibold text-zinc-100">{new Date(lastSession.date).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {lastSession.exercises.map((ex) => (
                <span key={ex.exerciseId} className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">{ex.name}</span>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Resources shortcut */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Resources</h2>
          <Link href="/app/resources" className="text-xs text-teal-400 font-medium">See all</Link>
        </div>
        <Link href="/app/resources">
          <Card className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600/20 flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5 text-violet-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-100">Programs & Guides</p>
              <p className="text-xs text-zinc-500">Your coach has shared 12 resources</p>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-zinc-600 ml-auto">
              <polyline points="9,18 15,12 9,6" />
            </svg>
          </Card>
        </Link>
      </div>
    </div>
  );
}
