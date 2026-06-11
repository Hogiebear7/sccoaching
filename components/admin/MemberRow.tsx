import Badge from "@/components/ui/Badge";
import type { Member } from "@/lib/mock-data";

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

export default function MemberRow({ member }: { member: Member }) {
  const tierVariant = member.tier.toLowerCase() as "basic" | "premium" | "elite";
  const statusVariant = member.status.toLowerCase() as "active" | "inactive";
  return (
    <tr className="border-b border-zinc-800 hover:bg-zinc-800/40 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-300 flex-shrink-0">
            {member.initials}
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-100">{member.name}</p>
            <p className="text-xs text-zinc-500">{member.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <Badge variant={tierVariant}>{member.tier}</Badge>
      </td>
      <td className="px-4 py-3 text-sm text-zinc-400">{formatDate(member.joinDate)}</td>
      <td className="px-4 py-3 text-sm text-zinc-400">{formatDate(member.lastVisit)}</td>
      <td className="px-4 py-3 text-sm font-medium text-zinc-300">{member.totalVisits}</td>
      <td className="px-4 py-3">
        <Badge variant={statusVariant}>{member.status}</Badge>
      </td>
      <td className="px-4 py-3 text-right">
        <button className="text-xs text-teal-500 hover:text-teal-400 font-medium">View</button>
      </td>
    </tr>
  );
}
