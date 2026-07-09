"use client";
import { useState } from "react";
import WorkoutLogger from "@/components/member/WorkoutLogger";
import WorkoutHistoryCard from "@/components/member/WorkoutHistoryCard";
import { workoutSessions, currentMember } from "@/lib/mock-data";

const allSessions = workoutSessions
  .filter((s) => s.memberId === currentMember.id)
  .sort((a, b) => b.date.localeCompare(a.date));

function SearchHistory() {
  const [query, setQuery] = useState("");
  const filtered = !query.trim()
    ? allSessions
    : allSessions.filter((s) => s.exercises.some((e) => e.name.toLowerCase().includes(query.toLowerCase())));

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by exercise name…"
          className="input-field pl-9"
        />
      </div>
      {query.trim() && filtered.length > 0 && (
        <div className="panel p-4">
          {(() => {
            const ex = filtered[0].exercises.find((e) => e.name.toLowerCase().includes(query.toLowerCase()));
            const best = ex?.sets.reduce((b, s) => s.weightKg > b.weightKg ? s : b);
            return (
              <div className="mb-3 p-3 bg-teal-500/[0.07] border border-teal-500/20 rounded-xl">
                <p className="text-xs text-zinc-500 mb-0.5">Last time you did <span className="text-zinc-300 font-medium">{ex?.name}</span></p>
                <p className="text-display text-[15px] text-gold tabular-nums">{best?.weightKg}kg × {best?.reps} reps</p>
                <p className="text-xs text-zinc-500">{new Date(filtered[0].date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
              </div>
            );
          })()}
        </div>
      )}
      {filtered.length === 0 && query.trim() && (
        <p className="text-sm text-zinc-500 text-center py-4">No sessions found for "{query}"</p>
      )}
      {filtered.map((s) => <WorkoutHistoryCard key={s.id} session={s} />)}
    </div>
  );
}

export default function WorkoutsPage() {
  const [tab, setTab] = useState<"log" | "history">("log");

  return (
    <div className="anim-rise pb-4">
      <div className="px-4 pt-7 pb-4">
        <h1 className="text-display text-[26px] text-zinc-50">Workouts</h1>
      </div>
      {/* Segmented tabs */}
      <div className="mx-4 mb-4 flex gap-0.5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-0.5">
        {(["log", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-[10px] py-2 text-sm font-medium capitalize transition-colors duration-150 ${tab === t ? "bg-white/[0.08] text-zinc-50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            {t === "log" ? "Log Workout" : "History"}
          </button>
        ))}
      </div>
      <div className="px-4">
        {tab === "log" ? (
          <WorkoutLogger memberId={currentMember.id} />
        ) : (
          <SearchHistory />
        )}
      </div>
    </div>
  );
}
