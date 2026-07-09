"use client";

import { useState } from "react";

import type { AiMessageRecord, MessageRecord } from "@/lib/db";
import type { CoachingContextDisplay } from "@/lib/ai-context";
import type { DrinkSettings } from "@/lib/drink-settings";
import { MessagesThread } from "@/components/messages/MessagesThread";
import { AiChat } from "./AiChat";

type Tab = "ai" | "coach";

export function MessagesView({
  aiMessages,
  coachMessages,
  aiConfigured,
  aiContext,
  initialPrompt,
  fallbackDrinkSettings = null,
}: {
  aiMessages: AiMessageRecord[];
  coachMessages: MessageRecord[];
  aiConfigured: boolean;
  aiContext: CoachingContextDisplay | null;
  initialPrompt: string | null;
  fallbackDrinkSettings?: DrinkSettings | null;
}) {
  const [tab, setTab] = useState<Tab>("ai");

  return (
    <div className="space-y-4">
      <div className="flex w-fit gap-0.5 rounded-lg border border-white/[0.09] bg-white/[0.03] p-0.5">
        <button
          type="button"
          onClick={() => setTab("ai")}
          aria-pressed={tab === "ai"}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-[color,background-color,transform] duration-150 active:scale-[0.97] ${
            tab === "ai"
              ? "bg-white/[0.08] text-zinc-50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          AI Coach
        </button>
        <button
          type="button"
          onClick={() => setTab("coach")}
          aria-pressed={tab === "coach"}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-[color,background-color,transform] duration-150 active:scale-[0.97] ${
            tab === "coach"
              ? "bg-white/[0.08] text-zinc-50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Message coach
        </button>
      </div>

      {tab === "ai" ? (
        <AiChat
          initialMessages={aiMessages}
          configured={aiConfigured}
          context={aiContext}
          initialPrompt={initialPrompt}
          fallbackDrinkSettings={fallbackDrinkSettings}
        />
      ) : (
        <MessagesThread messages={coachMessages} currentUserRole="member" />
      )}
    </div>
  );
}
