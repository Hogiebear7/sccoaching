import Link from "next/link";
import { classes, currentMember, workoutSessions } from "@/lib/mock-data";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const quickActions = [
  {
    href: "/app/coach",
    label: "Coach AI",
    sub: "Ask anything",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-teal-300">
        <path d="M12 3a7 7 0 0 0-7 7c0 2.1.93 4.09 2.54 5.43V19a2 2 0 0 0 2 2h4.92a2 2 0 0 0 2-2v-3.57A7 7 0 0 0 19 10a7 7 0 0 0-7-7z" />
        <path d="M9.5 21h5" />
      </svg>
    ),
  },
  {
    href: "/app/workouts",
    label: "Log workout",
    sub: "Track a session",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-gold">
        <path d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    href: "/app/resources",
    label: "Resources",
    sub: "12 from coach",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-violet-300">
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
      </svg>
    ),
  },
];

export default function AppDashboard() {
  const member = currentMember;
  const today = "2026-06-11";

  const todayClasses = classes.filter((c) => c.date === today).slice(0, 2);
  const nextClass = todayClasses[0];

  const memberSessions = workoutSessions.filter((s) => s.memberId === member.id);
  const thisMonthSessions = memberSessions.filter((s) => s.date.startsWith("2026-06"));
  const lastSession = [...memberSessions].sort((a, b) => b.date.localeCompare(a.date))[0];

  const capacityPct = nextClass ? Math.round((nextClass.enrolled / nextClass.capacity) * 100) : 0;

  return (
    <div className="anim-rise">
      {/* Immersive header — the brand moment */}
      <header className="relative overflow-hidden border-b border-white/[0.06] px-4 pb-6 pt-8">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-teal-950/70 via-teal-950/25 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(85%_100%_at_50%_0%,rgba(45,212,191,0.14),transparent)]" />
        <div className="relative">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-teal-200/70">{greeting()}</p>
              <h1 className="text-display mt-1 text-[32px] leading-none text-zinc-50">{member.name.split(" ")[0]}</h1>
            </div>
            <Link href="/app/profile" className="transition-transform duration-150 active:scale-95">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-b from-teal-500 to-teal-600 text-[13px] font-semibold text-white ring-1 ring-white/20 shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
                {member.initials}
              </div>
            </Link>
          </div>

          {/* Momentum — frosted inset strip */}
          <div className="mt-6 grid grid-cols-3 divide-x divide-white/[0.07] rounded-2xl border border-white/[0.1] bg-white/[0.05] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] backdrop-blur-md">
            <div className="flex flex-col items-center gap-1 px-2 py-3.5">
              <p className="text-display text-[22px] leading-none text-gold tabular-nums">{member.streak}</p>
              <p className="text-[10px] text-zinc-400">day streak</p>
            </div>
            <div className="flex flex-col items-center gap-1 px-2 py-3.5">
              <p className="text-display text-[22px] leading-none text-zinc-50 tabular-nums">{thisMonthSessions.length}</p>
              <p className="text-[10px] text-zinc-400">sessions Jun</p>
            </div>
            <div className="flex flex-col items-center gap-1 px-2 py-3.5">
              <p className="text-display text-[22px] leading-none text-zinc-50 tabular-nums">{member.totalVisits}</p>
              <p className="text-[10px] text-zinc-400">total visits</p>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-8 px-4 pb-4 pt-6">
        {/* Hero: next class */}
        {nextClass ? (
          <section>
            <div className="mb-2.5 flex items-baseline justify-between">
              <h2 className="label-caps">Up Next · Today</h2>
              <Link href="/app/schedule" className="text-xs font-medium text-gold transition-colors duration-150 hover:text-gold/80">Full schedule →</Link>
            </div>
            <div className="panel overflow-hidden">
              <div className="flex items-stretch">
                <div className="flex w-[88px] flex-shrink-0 flex-col items-center justify-center gap-0.5 border-r border-white/[0.06] bg-white/[0.02] py-6">
                  <span className="text-display text-[26px] leading-none text-zinc-50 tabular-nums">{nextClass.time.split(":")[0]}</span>
                  <span className="text-[13px] leading-none text-zinc-500 tabular-nums">:{nextClass.time.split(":")[1]}</span>
                </div>
                <div className="min-w-0 flex-1 p-4">
                  <p className="text-display text-[17px] leading-tight text-zinc-50">{nextClass.name}</p>
                  <p className="mt-1 text-[13px] text-zinc-400 tabular-nums">{nextClass.durationMins} min · {nextClass.coachName}</p>
                  <div className="mt-3 flex items-center gap-2.5">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className={`h-full rounded-full ${capacityPct >= 90 ? "bg-orange-500/90" : "bg-teal-400/80"}`} style={{ width: `${capacityPct}%` }} />
                    </div>
                    <span className="text-[11px] text-zinc-500 tabular-nums">{nextClass.enrolled}/{nextClass.capacity}</span>
                  </div>
                </div>
              </div>
              <div className="border-t border-white/[0.06] p-3">
                <Link
                  href="/app/schedule"
                  className="flex w-full items-center justify-center rounded-[10px] border border-teal-700/60 bg-gradient-to-b from-teal-500 to-teal-600 py-2.5 text-sm font-semibold text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_1px_2px_0_rgba(0,0,0,0.4)] transition-[background-color,transform] duration-150 hover:from-teal-400 hover:to-teal-500 active:translate-y-px"
                >
                  Reserve your spot
                </Link>
              </div>
            </div>
          </section>
        ) : (
          <section>
            <h2 className="label-caps mb-2.5">Today</h2>
            <div className="panel p-5 text-center">
              <p className="text-sm text-zinc-400">No classes scheduled today.</p>
              <Link href="/app/workouts" className="mt-2 block text-sm font-medium text-gold">Log a solo workout →</Link>
            </div>
          </section>
        )}

        {/* Quick actions */}
        <section>
          <h2 className="label-caps mb-2.5">Quick Actions</h2>
          <div className="grid grid-cols-3 gap-2.5">
            {quickActions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="panel hover-lift flex flex-col gap-3 p-3.5"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.04]">
                  {action.icon}
                </div>
                <div>
                  <p className="text-[13px] font-semibold leading-tight tracking-tight text-zinc-100">{action.label}</p>
                  <p className="mt-0.5 text-[10px] text-zinc-500">{action.sub}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Last workout */}
        {lastSession && (
          <section>
            <div className="mb-2.5 flex items-baseline justify-between">
              <h2 className="label-caps">Last Workout</h2>
              <Link href="/app/workouts" className="text-xs font-medium text-gold">History →</Link>
            </div>
            <div className="panel p-4">
              <p className="text-sm font-semibold tracking-tight text-zinc-50">
                {new Date(lastSession.date).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {lastSession.exercises.map((ex) => (
                  <span key={ex.exerciseId} className="rounded-lg border border-white/[0.05] bg-white/[0.05] px-2 py-1 text-xs text-zinc-300">{ex.name}</span>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
