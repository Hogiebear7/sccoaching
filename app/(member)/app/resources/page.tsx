"use client";
import { useState } from "react";
import ResourceCard from "@/components/member/ResourceCard";
import { resources } from "@/lib/mock-data";

const CATEGORIES = ["All", "Training", "Nutrition", "Mobility", "Mindset"] as const;

export default function ResourcesPage() {
  const [cat, setCat] = useState<string>("All");

  const filtered = cat === "All" ? resources : resources.filter((r) => r.category === cat);

  return (
    <div className="px-4 pt-6 pb-4">
      <h1 className="text-2xl font-bold text-zinc-50">Resources</h1>
      <p className="text-sm text-zinc-500 mt-0.5 mb-4">Guides and programs from your coach</p>

      {/* Filter chips */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-4 -mx-4 px-4">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${cat === c ? "bg-teal-600 text-white" : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200"}`}
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
