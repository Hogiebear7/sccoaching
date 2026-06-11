import Badge from "@/components/ui/Badge";
import type { Member } from "@/lib/mock-data";

export default function FrequentMembersList({ members }: { members: Member[] }) {
  const sorted = [...members].sort((a, b) => b.totalVisits - a.totalVisits).slice(0, 10);
  const max = sorted[0]?.totalVisits ?? 1;

  return (
    <div className="flex flex-col divide-y divide-zinc-800">
      {sorted.map((member, i) => {
        const tierVariant = member.tier.toLowerCase() as "basic" | "premium" | "elite";
        const barPct = (member.totalVisits / max) * 100;
        return (
          <div key={member.id} className="flex items-center gap-3 py-3">
            <span className="w-5 text-right text-xs font-bold text-zinc-600 flex-shrink-0">{i + 1}</span>
            <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-300 flex-shrink-0">
              {member.initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-medium text-zinc-100 truncate">{member.name}</p>
                <Badge variant={tierVariant}>{member.tier}</Badge>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-teal-600 rounded-full" style={{ width: `${barPct}%` }} />
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-bold text-zinc-100">{member.totalVisits}</p>
              <p className="text-[10px] text-zinc-500">visits</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
