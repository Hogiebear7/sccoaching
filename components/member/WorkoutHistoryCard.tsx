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
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="font-semibold text-zinc-100 text-sm">{formatDate(session.date)}</p>
          <p className="text-xs text-zinc-500">{session.durationMins} min · {session.exercises.length} exercises</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-teal-400">{vol.toLocaleString()} kg</p>
          <p className="text-[10px] text-zinc-500">total volume</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {session.exercises.map((ex) => {
          const topSet = ex.sets.reduce((b, s) => s.weightKg > b.weightKg ? s : b);
          return (
            <span key={ex.exerciseId} className="text-xs bg-zinc-800 text-zinc-300 px-2 py-1 rounded-lg">
              {ex.name} {topSet.weightKg > 0 ? `· ${topSet.weightKg}kg × ${topSet.reps}` : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}
