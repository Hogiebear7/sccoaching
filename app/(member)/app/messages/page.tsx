"use client";
import { useState } from "react";
import MessageThread from "@/components/member/MessageThread";
import { messages, currentMember } from "@/lib/mock-data";

const memberMessages = messages.filter(
  (m) => m.fromId === currentMember.id || m.toId === currentMember.id
).sort((a, b) => a.timestamp.localeCompare(b.timestamp));

export default function MessagesPage() {
  const [open, setOpen] = useState(true);
  const unread = memberMessages.filter((m) => !m.read && m.toId === currentMember.id).length;

  return (
    <div className="anim-rise flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="px-4 pt-6 pb-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-display text-[26px] text-zinc-50">Messages</h1>
          {unread > 0 && (
            <span className="bg-teal-500/15 border border-teal-500/30 text-teal-300 text-[11px] font-semibold px-2 py-0.5 rounded-full tabular-nums">{unread} new</span>
          )}
        </div>
      </div>

      {open ? (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Coach info banner */}
          <div className="mx-4 mb-3 flex items-center gap-3 p-3 panel flex-shrink-0">
            <div className="w-9 h-9 rounded-full bg-gradient-to-b from-teal-500 to-teal-600 flex items-center justify-center text-xs font-semibold text-white ring-1 ring-white/15 flex-shrink-0">SO</div>
            <div>
              <p className="text-sm font-semibold text-zinc-100">Coach Sarah O'Brien</p>
              <p className="text-xs text-zinc-500">Your personal coach</p>
            </div>
            <div className="ml-auto w-2 h-2 rounded-full bg-emerald-400" title="Online" />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <MessageThread messages={memberMessages} currentUserId={currentMember.id} />
          </div>
        </div>
      ) : (
        <div className="px-4">
          <button
            onClick={() => setOpen(true)}
            className="w-full panel p-4 flex items-center gap-3 hover:border-zinc-700 transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-b from-teal-500 to-teal-600 flex items-center justify-center text-xs font-semibold text-white ring-1 ring-white/15">SO</div>
            <div className="text-left">
              <p className="text-sm font-semibold text-zinc-100">Coach Sarah O'Brien</p>
              <p className="text-xs text-zinc-500">{memberMessages[memberMessages.length - 1]?.body.slice(0, 40)}…</p>
            </div>
            {unread > 0 && <span className="ml-auto bg-teal-500/15 border border-teal-500/30 text-teal-300 text-[11px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums">{unread}</span>}
          </button>
        </div>
      )}
    </div>
  );
}
