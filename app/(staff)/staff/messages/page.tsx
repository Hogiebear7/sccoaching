import Link from "next/link";

import { findMessageThreadSummaries, findProfileByUserId, findUserById } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff-auth";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.round(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.round(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function StaffMessagesPage() {
  await requireStaffPage("members.view");

  const summaries = findMessageThreadSummaries()
    .map((summary) => {
      const member = findUserById(summary.memberId);
      if (!member) return null;
      const profile = findProfileByUserId(member.id);
      return {
        ...summary,
        memberEmail: member.email,
        memberName: profile?.fullName ?? null,
        memberArchived: Boolean(member.archivedAt),
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const totalUnread = summaries.reduce((sum, s) => sum + s.unreadFromMemberCount, 0);

  return (
    <section className="space-y-6">
      <div>
        <p className="label-caps">Staff</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">Messages</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Every member conversation, newest first — open one to read and reply. Opening a
          conversation marks its messages as read.
          {totalUnread > 0 ? (
            <>
              {" "}
              <span className="font-medium text-primary">
                {totalUnread} unread message{totalUnread === 1 ? "" : "s"}.
              </span>
            </>
          ) : null}
        </p>
      </div>

      {summaries.length === 0 ? (
        <div className="panel p-6">
          <p className="text-sm text-muted-foreground">
            No messages yet. Member conversations will show up here as soon as someone reaches
            out.
          </p>
        </div>
      ) : (
        <div className="panel divide-y divide-border p-0">
          {summaries.map((s) => {
            const isUnread = s.unreadFromMemberCount > 0;
            return (
              <Link
                key={s.memberId}
                href={`/staff/members/${s.memberId}#messages`}
                className="flex items-start justify-between gap-4 px-5 py-4 transition hover:bg-accent"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={`text-sm ${isUnread ? "font-bold text-foreground" : "font-medium text-foreground/80"}`}>
                      {s.memberName ?? s.memberEmail}
                    </p>
                    {s.memberArchived ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        Archived
                      </span>
                    ) : null}
                  </div>
                  <p
                    className={`mt-1 max-w-xl truncate text-sm ${
                      isUnread ? "font-semibold text-foreground" : "font-normal text-muted-foreground"
                    }`}
                  >
                    {s.lastMessage.senderRole === "staff" ? "You: " : ""}
                    {s.lastMessage.body}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    {relativeTime(s.lastMessage.createdAt)}
                  </span>
                  {isUnread ? (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      {s.unreadFromMemberCount} new
                    </span>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
