"use client";

import { useState } from "react";

import type { AiMessageRecord, MessageRecord } from "@/lib/db";
import type { CoachingContextDisplay } from "@/lib/ai-context";
import type { DrinkSettings } from "@/lib/drink-settings";
import { MessagesThread } from "@/components/messages/MessagesThread";
import { SegmentedControl } from "@/components/member/SegmentedControl";
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
  // Coach messaging is the default: it's the human relationship members come
  // here for. A deep link with an AI prompt (?prompt=…) still opens the AI tab.
  const [tab, setTab] = useState<Tab>(initialPrompt ? "ai" : "coach");

  return (
    <div className="space-y-4">
      <SegmentedControl
        label="Conversation"
        value={tab}
        onChange={setTab}
        options={[
          { value: "coach", label: "Your coach" },
          { value: "ai", label: "AI coach" },
        ]}
      />

      {tab === "ai" ? (
        <AiChat
          initialMessages={aiMessages}
          configured={aiConfigured}
          context={aiContext}
          initialPrompt={initialPrompt}
          fallbackDrinkSettings={fallbackDrinkSettings}
        />
      ) : (
        <MessagesThread messages={coachMessages} currentUserRole="member" variant="member" />
      )}
    </div>
  );
}
