import Badge from "@/components/ui/Badge";
import type { Resource } from "@/lib/mock-data";

const icons: Record<string, React.ReactNode> = {
  PDF: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5 text-zinc-400">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" />
    </svg>
  ),
  Video: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5 text-teal-400">
      <polygon points="5,3 19,12 5,21" />
    </svg>
  ),
  Program: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5 text-violet-400">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
    </svg>
  ),
};

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ResourceCard({ resource }: { resource: Resource }) {
  const typeKey = resource.type.toLowerCase() as Parameters<typeof Badge>[0]["variant"];
  return (
    <div className="panel p-4 flex items-start gap-3 cursor-pointer transition-[transform,border-color] duration-150 hover:border-white/[0.12] active:scale-[0.99]">
      <div className="flex-shrink-0 w-10 h-10 bg-white/[0.05] border border-white/[0.05] rounded-xl flex items-center justify-center">
        {icons[resource.type]}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-zinc-100 text-sm leading-snug">{resource.title}</p>
        <p className="text-xs text-zinc-500 mt-0.5 line-clamp-1">{resource.description}</p>
        <div className="flex items-center gap-2 mt-2">
          <Badge variant={typeKey}>{resource.type}</Badge>
          <span className="text-[10px] text-zinc-600">{resource.sizeLabel}</span>
          <span className="text-[10px] text-zinc-600">· {formatDate(resource.sharedDate)}</span>
        </div>
      </div>
    </div>
  );
}
