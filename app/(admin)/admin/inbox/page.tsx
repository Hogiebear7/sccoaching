"use client";
import { useState } from "react";
import TopBar from "@/components/admin/TopBar";
import InboxThread from "@/components/admin/InboxThread";
import EmptyState from "@/components/ui/EmptyState";
import { messages } from "@/lib/mock-data";

const threads = [...messages].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
const unread = threads.filter((m) => !m.read && m.toId === "coach").length;

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function InboxPage() {
  const [active, setActive] = useState(threads[0]?.id ?? null);
  const activeMsg = threads.find((m) => m.id === active);

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar title="Inbox" subtitle={unread > 0 ? `${unread} unread` : "All caught up"} />
      <div className="flex flex-1 overflow-hidden">
        {/* Thread list */}
        <div className="w-80 flex-shrink-0 border-r border-white/[0.06] overflow-y-auto">
          {threads.map((msg) => (
            <InboxThread key={msg.id} message={msg} active={active === msg.id} onClick={() => setActive(msg.id)} />
          ))}
        </div>
        {/* Message detail */}
        {activeMsg ? (
          <div className="anim-fade flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-display text-lg text-zinc-50">{activeMsg.subject}</h2>
                <p className="text-sm text-zinc-500 mt-1">
                  {activeMsg.fromName} → {activeMsg.toName}
                </p>
              </div>
              <span className="text-xs text-zinc-600 tabular-nums">{formatDate(activeMsg.timestamp)} {formatTime(activeMsg.timestamp)}</span>
            </div>
            <div className="panel p-5">
              <p className="text-sm text-zinc-200 leading-relaxed">{activeMsg.body}</p>
            </div>
            {/* Reply */}
            <div className="mt-auto pt-4 border-t border-white/[0.06]">
              <p className="label-caps mb-2">Reply</p>
              <div className="flex gap-3">
                <textarea
                  rows={3}
                  placeholder="Type your reply…"
                  className="input-field flex-1 resize-none"
                />
                <button className="self-end rounded-[10px] border border-teal-700/60 bg-gradient-to-b from-teal-500 to-teal-600 px-5 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_1px_2px_0_rgba(0,0,0,0.4)] transition-[background-color,transform] duration-150 hover:from-teal-400 hover:to-teal-500 active:translate-y-px">Send</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              }
              title="No conversation selected"
              description="Choose a thread from the list to read and reply."
            />
          </div>
        )}
      </div>
    </div>
  );
}
