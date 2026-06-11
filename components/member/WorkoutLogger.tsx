"use client";
import { useState } from "react";
import ExerciseSearchModal from "./ExerciseSearchModal";
import Button from "@/components/ui/Button";
import type { Exercise } from "@/lib/mock-data";

interface LoggedSet { reps: string; weightKg: string; }
interface LoggedExercise { exercise: Exercise; sets: LoggedSet[]; }

interface Props { memberId: string; }

export default function WorkoutLogger({ memberId }: Props) {
  const [session, setSession] = useState<LoggedExercise[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [finished, setFinished] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  function addExercise(ex: Exercise) {
    setShowSearch(false);
    if (session.some((s) => s.exercise.id === ex.id)) return;
    setSession((prev) => [...prev, { exercise: ex, sets: [{ reps: "", weightKg: "" }] }]);
  }

  function addSet(exIdx: number) {
    setSession((prev) => prev.map((item, i) =>
      i === exIdx ? { ...item, sets: [...item.sets, { reps: "", weightKg: "" }] } : item
    ));
  }

  function updateSet(exIdx: number, setIdx: number, field: keyof LoggedSet, value: string) {
    setSession((prev) => prev.map((item, i) =>
      i === exIdx ? { ...item, sets: item.sets.map((s, j) => j === setIdx ? { ...s, [field]: value } : s) } : item
    ));
  }

  function removeExercise(exIdx: number) {
    setSession((prev) => prev.filter((_, i) => i !== exIdx));
  }

  if (finished) {
    return (
      <div className="flex flex-col items-center py-12 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-teal-600/20 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-8 h-8 text-teal-400">
            <polyline points="20,6 9,17 4,12" />
          </svg>
        </div>
        <div>
          <p className="text-xl font-bold text-zinc-100">Session Complete!</p>
          <p className="text-sm text-zinc-500 mt-1">{session.length} exercises logged</p>
        </div>
        <Button onClick={() => { setSession([]); setFinished(false); }} variant="secondary" size="md">
          Start New Workout
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {session.length === 0 ? (
        <div className="flex flex-col items-center py-10 gap-3 text-center">
          <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-7 h-7 text-zinc-500">
              <path d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <p className="text-zinc-400 text-sm">No exercises added yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {session.map((item, exIdx) => (
            <div key={item.exercise.id} className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-semibold text-zinc-100 text-sm">{item.exercise.name}</p>
                  <p className="text-xs text-zinc-500">{item.exercise.muscleGroup}</p>
                </div>
                <button onClick={() => removeExercise(exIdx)} className="text-zinc-600 hover:text-red-400 transition-colors p-1">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              {/* Set header */}
              <div className="grid grid-cols-[28px_1fr_1fr_40px] gap-2 mb-2 px-1">
                <span className="text-[10px] text-zinc-600 text-center">SET</span>
                <span className="text-[10px] text-zinc-600 text-center">WEIGHT (kg)</span>
                <span className="text-[10px] text-zinc-600 text-center">REPS</span>
                <span />
              </div>
              {item.sets.map((set, setIdx) => (
                <div key={setIdx} className="grid grid-cols-[28px_1fr_1fr_40px] gap-2 mb-1.5 items-center">
                  <span className="text-xs text-zinc-500 text-center font-medium">{setIdx + 1}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={set.weightKg}
                    onChange={(e) => updateSet(exIdx, setIdx, "weightKg", e.target.value)}
                    placeholder="0"
                    className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-zinc-100 text-center placeholder-zinc-600 outline-none focus:border-teal-600"
                  />
                  <input
                    type="number"
                    inputMode="numeric"
                    value={set.reps}
                    onChange={(e) => updateSet(exIdx, setIdx, "reps", e.target.value)}
                    placeholder="0"
                    className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-zinc-100 text-center placeholder-zinc-600 outline-none focus:border-teal-600"
                  />
                  <button
                    onClick={() => setSession((prev) => prev.map((it, i) => i === exIdx ? { ...it, sets: it.sets.filter((_, j) => j !== setIdx) } : it))}
                    className="text-zinc-600 hover:text-red-400 transition-colors flex justify-center"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
              <button onClick={() => addSet(exIdx)} className="mt-2 text-xs text-teal-500 hover:text-teal-400 font-medium flex items-center gap-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add set
              </button>
            </div>
          ))}
        </div>
      )}

      <Button variant="secondary" onClick={() => setShowSearch(true)} className="w-full">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add Exercise
      </Button>

      {session.length > 0 && (
        <Button variant="primary" onClick={() => setFinished(true)} className="w-full" size="lg">
          Finish Workout
        </Button>
      )}

      {showSearch && <ExerciseSearchModal memberId={memberId} onSelect={addExercise} onClose={() => setShowSearch(false)} />}
    </div>
  );
}
