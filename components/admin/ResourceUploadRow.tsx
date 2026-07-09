import Badge from "@/components/ui/Badge";
import type { Resource } from "@/lib/mock-data";

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ResourceUploadRow({ resource }: { resource: Resource }) {
  const typeKey = resource.type.toLowerCase() as Parameters<typeof Badge>[0]["variant"];
  return (
    <tr className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.025] transition-colors duration-150">
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium text-zinc-100">{resource.title}</p>
        </div>
      </td>
      <td className="px-5 py-3.5">
        <Badge variant={typeKey}>{resource.type}</Badge>
      </td>
      <td className="px-5 py-3.5 text-[13px] text-zinc-400">{resource.category}</td>
      <td className="px-5 py-3.5 text-[13px] text-zinc-400 tabular-nums">{formatDate(resource.sharedDate)}</td>
      <td className="px-5 py-3.5 text-[13px] text-zinc-500 tabular-nums">{resource.sizeLabel}</td>
      <td className="px-5 py-3.5 text-right">
        <button className="text-xs text-zinc-500 hover:text-red-400 font-medium transition-colors duration-150">Remove</button>
      </td>
    </tr>
  );
}
