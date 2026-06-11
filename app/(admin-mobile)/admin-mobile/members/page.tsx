"use client";
import { useState } from "react";
import MemberCard from "@/components/admin-mobile/MemberCard";
import { members } from "@/lib/mock-data";

export default function CoachMembersPage() {
  const [query, setQuery] = useState("");
  const filtered = members.filter(
    (m) =>
      m.name.toLowerCase().includes(query.toLowerCase()) ||
      m.email.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="px-4 pt-6 pb-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-50">Members</h1>
        <span className="text-sm text-zinc-500">{filtered.length} shown</span>
      </div>

      {/* Search */}
      <div className="relative">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          placeholder="Search members…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-teal-600"
        />
      </div>

      {/* Member list */}
      <div className="flex flex-col gap-2">
        {filtered.map((m) => (
          <MemberCard key={m.id} member={m} />
        ))}
        {filtered.length === 0 && (
          <p className="text-center text-zinc-600 text-sm py-8">No members found</p>
        )}
      </div>
    </div>
  );
}
