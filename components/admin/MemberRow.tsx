import Badge from "@/components/ui/Badge";
import type { Member } from "@/lib/mock-data";

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

export default function MemberRow({ member }: { member: Member }) {
  const tierVariant = member.tier.toLowerCase() as "basic" | "premium" | "elite";
  const statusVariant = member.status.toLowerCase() as "active" | "inactive";
  return (
    <tr className="group transition-colors duration-150 hover:bg-white/[0.025]">
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[11px] font-semibold text-zinc-300 ring-1 ring-white/10">
            {member.initials}
          </div>
          <div>
            <p className="text-sm font-medium leading-tight text-zinc-100">{member.name}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{member.email}</p>
          </div>
        </div>
      </td>
      <td className="px-5 py-3.5">
        <Badge variant={tierVariant}>{member.tier}</Badge>
      </td>
      <td className="px-5 py-3.5 text-[13px] text-zinc-400 tabular-nums">{formatDate(member.joinDate)}</td>
      <td className="px-5 py-3.5 text-[13px] text-zinc-400 tabular-nums">{formatDate(member.lastVisit)}</td>
      <td className="px-5 py-3.5 text-right text-[13px] font-medium text-zinc-300 tabular-nums">{member.totalVisits}</td>
      <td className="px-5 py-3.5">
        <Badge variant={statusVariant}>{member.status}</Badge>
      </td>
      <td className="px-5 py-3.5 text-right">
        <button className="text-xs font-medium text-zinc-500 opacity-0 transition-all duration-150 hover:text-teal-400 group-hover:opacity-100 focus-visible:opacity-100">View →</button>
      </td>
    </tr>
  );
}
