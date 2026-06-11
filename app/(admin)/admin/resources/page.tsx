import TopBar from "@/components/admin/TopBar";
import ResourceUploadRow from "@/components/admin/ResourceUploadRow";
import { resources } from "@/lib/mock-data";
import Button from "@/components/ui/Button";

export default function AdminResourcesPage() {
  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar
        title="Resources"
        subtitle={`${resources.length} files shared`}
        action={
          <Button size="sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17,8 12,3 7,8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Title</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Category</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Shared</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Size</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {resources.map((r) => <ResourceUploadRow key={r.id} resource={r} />)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
