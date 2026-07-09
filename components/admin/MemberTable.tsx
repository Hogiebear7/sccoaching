"use client";
import { useState } from "react";
import MemberRow from "./MemberRow";
import EmptyState from "@/components/ui/EmptyState";
import type { Member } from "@/lib/mock-data";

const FILTERS = ["All", "Active", "Inactive", "Basic", "Premium", "Elite"] as const;

export default function MemberTable({ members }: { members: Member[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("All");

  const filtered = members.filter((m) => {
    const matchSearch = !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.email.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "All" || m.status === filter || m.tier === filter;
    return matchSearch && matchFilter;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-52 flex-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members…"
            className="input-field pl-9"
          />
        </div>
        {/* Segmented filter */}
        <div className="flex gap-0.5 rounded-[10px] border border-white/[0.09] bg-white/[0.03] p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
                filter === f
                  ? "bg-white/[0.08] text-zinc-50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="panel overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.08]">
              <th className="px-5 py-3 text-left label-caps">Member</th>
              <th className="px-5 py-3 text-left label-caps">Tier</th>
              <th className="px-5 py-3 text-left label-caps">Joined</th>
              <th className="px-5 py-3 text-left label-caps">Last Visit</th>
              <th className="px-5 py-3 text-right label-caps">Visits</th>
              <th className="px-5 py-3 text-left label-caps">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    icon={
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
                        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                    }
                    title="No members found"
                    description="Try a different name, email, or filter."
                  />
                </td>
              </tr>
            ) : (
              filtered.map((m) => <MemberRow key={m.id} member={m} />)
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-600 tabular-nums">{filtered.length} of {members.length} members shown</p>
    </div>
  );
}
