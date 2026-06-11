import Badge from "@/components/ui/Badge";
import type { Resource } from "@/lib/mock-data";

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ResourceUploadRow({ resource }: { resource: Resource }) {
  const typeKey = resource.type.toLowerCase() as Parameters<typeof Badge>[0]["variant"];
  return (
    <tr className="border-b border-zinc-800 hover:bg-zinc-800/40 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium text-zinc-100">{resource.title}</p>
        </div>
      </td>
      <td className="px-4 py-3">
        <Badge variant={typeKey}>{resource.type}</Badge>
      </td>
      <td className="px-4 py-3 text-sm text-zinc-400">{resource.category}</td>
      <td className="px-4 py-3 text-sm text-zinc-400">{formatDate(resource.sharedDate)}</td>
      <td className="px-4 py-3 text-sm text-zinc-500">{resource.sizeLabel}</td>
      <td className="px-4 py-3 text-right">
        <button className="text-xs text-zinc-500 hover:text-red-400 font-medium transition-colors">Remove</button>
      </td>
    </tr>
  );
}
