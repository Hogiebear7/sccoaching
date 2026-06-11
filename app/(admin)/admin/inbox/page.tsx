"use client";
import { useState } from "react";
import TopBar from "@/components/admin/TopBar";
import InboxThread from "@/components/admin/InboxThread";
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
        <div className="w-80 flex-shrink-0 border-r border-zinc-800 overflow-y-auto">
          {threads.map((msg) => (
            <InboxThread key={msg.id} message={msg} active={active === msg.id} onClick={() => setActive(msg.id)} />
          ))}
        </div>
        {/* Message detail */}
        {activeMsg ? (
          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-zinc-50">{activeMsg.subject}</h2>
                <p className="text-sm text-zinc-500 mt-0.5">
                  {activeMsg.fromName} → {activeMsg.toName}
                </p>
              </div>
              <span className="text-xs text-zinc-600">{formatDate(activeMsg.timestamp)} {formatTime(activeMsg.timestamp)}</span>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
              <p className="text-sm text-zinc-200 leading-relaxed">{activeMsg.body}</p>
            </div>
            {/* Reply */}
            <div className="mt-auto pt-4 border-t border-zinc-800">
              <p className="text-xs text-zinc-500 mb-2 font-medium">Reply</p>
              <div className="flex gap-3">
                <textarea
                  rows={3}
                  placeholder="Type your reply…"
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-teal-600 resize-none"
                />
                <button className="self-end bg-teal-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-teal-500 transition-colors">Send</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-zinc-600 text-sm">Select a message</p>
          </div>
        )}
      </div>
    </div>
  );
}
