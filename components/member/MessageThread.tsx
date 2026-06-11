"use client";
import { useState } from "react";
import type { Message } from "@/lib/mock-data";

interface Props {
  messages: Message[];
  currentUserId: string;
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function MessageThread({ messages, currentUserId }: Props) {
  const [input, setInput] = useState("");
  const [localMsgs, setLocalMsgs] = useState<Message[]>(messages);

  function send() {
    if (!input.trim()) return;
    const newMsg: Message = {
      id: `local-${Date.now()}`,
      fromId: currentUserId,
      toId: "coach",
      fromName: "Alex Rivera",
      toName: "Coach Sarah",
      subject: "Re: message",
      body: input.trim(),
      timestamp: new Date().toISOString(),
      read: true,
    };
    setLocalMsgs((prev) => [...prev, newMsg]);
    setInput("");
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 no-scrollbar">
        {localMsgs.map((msg, i) => {
          const isMine = msg.fromId === currentUserId;
          const showDate = i === 0 || formatDate(localMsgs[i - 1].timestamp) !== formatDate(msg.timestamp);
          return (
            <div key={msg.id}>
              {showDate && (
                <p className="text-center text-[10px] text-zinc-600 my-2">{formatDate(msg.timestamp)}</p>
              )}
              <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[78%] ${isMine ? "items-end" : "items-start"} flex flex-col gap-0.5`}>
                  <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${isMine ? "bg-teal-600 text-white rounded-br-sm" : "bg-zinc-800 text-zinc-100 rounded-bl-sm"}`}>
                    {msg.body}
                  </div>
                  <span className="text-[10px] text-zinc-600 px-1">{formatTime(msg.timestamp)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-4 pb-4 pt-2 border-t border-zinc-800">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Message…"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-full px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-teal-600"
          />
          <button
            onClick={send}
            disabled={!input.trim()}
            className="w-10 h-10 rounded-full bg-teal-600 flex items-center justify-center hover:bg-teal-500 disabled:opacity-40 transition-colors flex-shrink-0"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-white">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22,2 15,22 11,13 2,9" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
