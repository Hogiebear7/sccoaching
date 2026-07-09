import type { WorkoutSession } from "@/lib/mock-data";

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function totalVolume(session: WorkoutSession) {
  return session.exercises.reduce((total, ex) =>
    total + ex.sets.reduce((s, set) => s + set.reps * set.weightKg, 0), 0
  );
}

export default function WorkoutHistoryCard({ session }: { session: WorkoutSession }) {
  const vol = totalVolume(session);
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="font-semibold tracking-tight text-zinc-100 text-sm leading-tight">{formatDate(session.date)}</p>
          <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">{session.durationMins} min · {session.exercises.length} exercises</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-teal-400 tabular-nums leading-tight">{vol.toLocaleString()} kg</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">total volume</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {session.exercises.map((ex) => {
          const topSet = ex.sets.reduce((b, s) => s.weightKg > b.weightKg ? s : b);
          return (
            <span key={ex.exerciseId} className="text-xs bg-white/[0.05] border border-white/[0.05] text-zinc-300 px-2 py-1 rounded-lg tabular-nums">
              {ex.name} {topSet.weightKg > 0 ? `· ${topSet.weightKg}kg × ${topSet.reps}` : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}
