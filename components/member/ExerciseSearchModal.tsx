"use client";
import { useState } from "react";
import { exercises, getLastPerformed } from "@/lib/mock-data";
import type { Exercise } from "@/lib/mock-data";

function daysSince(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

interface Props {
  memberId: string;
  onSelect: (exercise: Exercise) => void;
  onClose: () => void;
}

export default function ExerciseSearchModal({ memberId, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");

  const filtered = exercises.filter(
    (e) => e.name.toLowerCase().includes(query.toLowerCase()) || e.muscleGroup.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col" onClick={onClose}>
      <div className="flex-1 bg-black/60 backdrop-blur-sm" />
      <div
        className="bg-zinc-900 rounded-t-3xl border-t border-zinc-800 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h3 className="font-semibold text-zinc-100">Add Exercise</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 p-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="px-4 pb-3">
          <div className="relative">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search exercises…"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-teal-600"
            />
          </div>
        </div>
        <div className="overflow-y-auto flex-1 px-4 pb-6 no-scrollbar">
          {filtered.length === 0 && (
            <p className="text-sm text-zinc-500 text-center py-8">No exercises found</p>
          )}
          {filtered.map((ex) => {
            const last = getLastPerformed(ex.name, memberId);
            return (
              <button
                key={ex.id}
                onClick={() => onSelect(ex)}
                className="w-full text-left flex items-center justify-between py-3 border-b border-zinc-800 last:border-0 hover:bg-zinc-800/50 rounded-lg px-2 -mx-2 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-zinc-100">{ex.name}</p>
                  <p className="text-xs text-zinc-500">{ex.muscleGroup}</p>
                </div>
                {last ? (
                  <div className="text-right ml-2">
                    <p className="text-xs font-medium text-teal-400">{last.maxWeightKg}kg × {last.reps}</p>
                    <p className="text-[10px] text-zinc-600">{daysSince(last.date)}</p>
                  </div>
                ) : (
                  <span className="text-[10px] text-zinc-600 ml-2">No history</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
