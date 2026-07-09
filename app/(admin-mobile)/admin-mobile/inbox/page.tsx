"use client";
import { useState } from "react";
import { messages } from "@/lib/mock-data";

const threads = [...messages].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

function formatAge(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const h = Math.floor(diff / 3.6e6);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function CoachInboxPage() {
  const [active, setActive] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sent, setSent] = useState(false);

  const activeMsg = threads.find((m) => m.id === active);

  function handleSend() {
    if (!replyText.trim()) return;
    setSent(true);
    setReplyText("");
    setTimeout(() => setSent(false), 2000);
  }

  if (active && activeMsg) {
    return (
      <div className="flex flex-col h-full">
        {/* Detail header */}
        <div className="flex items-center gap-3 px-4 pt-6 pb-4 border-b border-white/[0.06]">
          <button
            onClick={() => setActive(null)}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] transition-colors duration-150 hover:bg-white/[0.07]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-zinc-400">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-100 truncate">{activeMsg.subject}</p>
            <p className="text-xs text-zinc-500">{activeMsg.fromName}</p>
          </div>
        </div>

        {/* Message body */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="panel p-4">
            <p className="text-sm text-zinc-200 leading-relaxed">{activeMsg.body}</p>
            <p className="text-xs text-zinc-600 mt-3 text-right">{formatAge(activeMsg.timestamp)}</p>
          </div>
        </div>

        {/* Reply box */}
        <div className="px-4 pb-4 pt-3 border-t border-white/[0.06]">
          {sent ? (
            <div className="flex items-center justify-center gap-2 bg-teal-600/10 border border-teal-600/30 rounded-xl py-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-teal-400">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <p className="text-sm text-teal-400 font-medium">Reply sent</p>
            </div>
          ) : (
            <div className="flex gap-2">
              <textarea
                rows={2}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Reply…"
                className="input-field flex-1 resize-none"
              />
              <button
                onClick={handleSend}
                className="self-end rounded-[10px] border border-teal-700/60 bg-gradient-to-b from-teal-500 to-teal-600 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16)] transition-[background-color,transform] duration-150 hover:from-teal-400 hover:to-teal-500 active:translate-y-px"
              >
                Send
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 pb-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-display text-[26px] text-zinc-50">Inbox</h1>
        {threads.filter((m) => !m.read && m.toId === "coach").length > 0 && (
          <span className="bg-teal-600/20 text-teal-400 text-xs font-medium px-2.5 py-1 rounded-full">
            {threads.filter((m) => !m.read && m.toId === "coach").length} unread
          </span>
        )}
      </div>

      <div className="flex flex-col divide-y divide-white/[0.05]">
        {threads.map((msg) => (
          <button
            key={msg.id}
            onClick={() => setActive(msg.id)}
            className="py-3.5 text-left flex items-start gap-3 w-full"
          >
            {/* Avatar */}
            <div className="w-10 h-10 rounded-full bg-zinc-800 ring-1 ring-white/10 flex items-center justify-center text-sm font-semibold text-zinc-300 flex-shrink-0">
              {msg.fromName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className={`text-sm font-medium truncate ${!msg.read && msg.toId === "coach" ? "text-zinc-50" : "text-zinc-300"}`}>
                  {msg.fromName}
                </p>
                <p className="text-xs text-zinc-600 flex-shrink-0">{formatAge(msg.timestamp)}</p>
              </div>
              <p className={`text-xs truncate mt-0.5 ${!msg.read && msg.toId === "coach" ? "text-zinc-200 font-medium" : "text-zinc-500"}`}>
                {msg.subject}
              </p>
              <p className="text-xs text-zinc-600 truncate mt-0.5">{msg.body}</p>
            </div>
            {!msg.read && msg.toId === "coach" && (
              <div className="w-2 h-2 bg-teal-400 rounded-full flex-shrink-0 mt-1.5" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
