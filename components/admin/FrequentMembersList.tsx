import Badge from "@/components/ui/Badge";
import type { Member } from "@/lib/mock-data";

export default function FrequentMembersList({ members }: { members: Member[] }) {
  const sorted = [...members].sort((a, b) => b.totalVisits - a.totalVisits).slice(0, 10);
  const max = sorted[0]?.totalVisits ?? 1;

  return (
    <div className="flex flex-col divide-y divide-white/[0.05]">
      {sorted.map((member, i) => {
        const tierVariant = member.tier.toLowerCase() as "basic" | "premium" | "elite";
        const barPct = (member.totalVisits / max) * 100;
        return (
          <div key={member.id} className="flex items-center gap-3 py-3">
            <span className="w-5 text-right text-xs font-medium text-zinc-600 flex-shrink-0 tabular-nums">{i + 1}</span>
            <div className="w-8 h-8 rounded-full bg-white/[0.06] ring-1 ring-white/10 flex items-center justify-center text-[11px] font-semibold text-zinc-300 flex-shrink-0">
              {member.initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <p className="text-sm font-medium text-zinc-100 truncate">{member.name}</p>
                <Badge variant={tierVariant}>{member.tier}</Badge>
              </div>
              <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
                <div className="h-full bg-teal-400/80 rounded-full" style={{ width: `${barPct}%` }} />
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-semibold text-zinc-100 tabular-nums leading-tight">{member.totalVisits}</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">visits</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
