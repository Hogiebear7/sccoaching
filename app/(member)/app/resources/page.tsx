"use client";
import { useState } from "react";
import ResourceCard from "@/components/member/ResourceCard";
import { resources } from "@/lib/mock-data";

const CATEGORIES = ["All", "Training", "Nutrition", "Mobility", "Mindset"] as const;

export default function ResourcesPage() {
  const [cat, setCat] = useState<string>("All");

  const filtered = cat === "All" ? resources : resources.filter((r) => r.category === cat);

  return (
    <div className="anim-rise px-4 pt-7 pb-4">
      <h1 className="text-display text-[26px] text-zinc-50">Resources</h1>
      <p className="text-sm text-zinc-500 mt-0.5 mb-4">Guides and programs from your coach</p>

      {/* Filter chips */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-4 -mx-4 px-4">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-95 ${cat === c ? "border border-teal-700/60 bg-gradient-to-b from-teal-500 to-teal-600 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16)]" : "border border-white/[0.08] bg-zinc-900 text-zinc-400 hover:border-white/[0.15] hover:text-zinc-200"}`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {filtered.map((r) => <ResourceCard key={r.id} resource={r} />)}
      </div>
    </div>
  );
}
