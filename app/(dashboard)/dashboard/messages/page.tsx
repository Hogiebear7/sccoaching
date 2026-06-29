import { cookies } from "next/headers";

import { findMessagesByMemberId, findUserById } from "@/lib/db";
import { verifySession } from "@/lib/session";
import { MessagesThread } from "@/components/messages/MessagesThread";

export default async function DashboardMessagesPage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return (
      <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.24em] text-teal-400">Messages</p>
        <h2 className="mt-2 text-3xl font-semibold text-zinc-50">
          No messages available
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          We couldn&apos;t load account data. Try logging out and back in.
        </p>
      </section>
    );
  }

  const messages = findMessagesByMemberId(user.id);

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.24em] text-teal-400">Messages</p>
        <h2 className="mt-2 text-3xl font-semibold text-zinc-50">Coach messages</h2>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          Message your coach directly. Staff can see and reply to this thread.
        </p>
      </div>

      <MessagesThread messages={messages} currentUserRole="member" />
    </section>
  );
}
