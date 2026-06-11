import Badge from "@/components/ui/Badge";
import type { Member } from "@/lib/mock-data";

function daysSince(d: string) {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

export default function MemberCard({ member }: { member: Member }) {
  const tierVariant = member.tier.toLowerCase() as "basic" | "premium" | "elite";
  const statusVariant = member.status.toLowerCase() as "active" | "inactive";
  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center text-sm font-bold text-zinc-300 flex-shrink-0">
        {member.initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-zinc-100 text-sm">{member.name}</p>
          <Badge variant={tierVariant}>{member.tier}</Badge>
          <Badge variant={statusVariant}>{member.status}</Badge>
        </div>
        <p className="text-xs text-zinc-500 mt-0.5">{member.totalVisits} visits · Last in {daysSince(member.lastVisit)}</p>
        <p className="text-xs text-zinc-600 truncate">{member.goals}</p>
      </div>
      <button className="flex-shrink-0 text-zinc-600 hover:text-teal-400 transition-colors p-1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
          <polyline points="9,18 15,12 9,6" />
        </svg>
      </button>
    </div>
  );
}
