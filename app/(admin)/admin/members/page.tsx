import TopBar from "@/components/admin/TopBar";
import MemberTable from "@/components/admin/MemberTable";
import { members } from "@/lib/mock-data";
import Button from "@/components/ui/Button";

export default function MembersPage() {
  const active = members.filter((m) => m.status === "Active").length;
  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar
        title="Members"
        subtitle={`${active} active · ${members.length} total`}
        action={
          <Button size="sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Member
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="anim-rise"><MemberTable members={members} /></div>
      </div>
    </div>
  );
}
