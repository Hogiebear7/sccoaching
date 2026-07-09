import { cookies } from "next/headers";

import {
  findAiMessagesByUserId,
  findMessagesByMemberId,
  findProfileByUserId,
  findRecoveryLogsByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
} from "@/lib/db";
import { buildCoachingContext, type CoachingContextDisplay } from "@/lib/ai-context";
import { PageHeader } from "@/components/ui/PageHeader";
import { isAiConfigured } from "@/lib/ai";
import { verifySession } from "@/lib/session";
import { MessagesView } from "./MessagesView";

export default async function DashboardMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string }>;
}) {
  const { prompt } = await searchParams;
  // Prefill from in-app handoffs (e.g. Nutrition → AI Coach); capped and
  // never auto-sent — the member reviews and presses Send.
  const initialPrompt = typeof prompt === "string" ? prompt.slice(0, 500) : null;

  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return (
      <section>
        <p className="label-caps">Messages</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight text-zinc-50">
          No messages available
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
          We couldn&apos;t load account data. Try logging out and back in.
        </p>
      </section>
    );
  }

  const aiMessages = findAiMessagesByUserId(user.id);
  const coachMessages = findMessagesByMemberId(user.id);

  // Grounding summary for the chat header — same inputs the assistant sees.
  const profile = findProfileByUserId(user.id);
  let aiContext: CoachingContextDisplay | null = null;
  if (profile) {
    aiContext = buildCoachingContext({
      profile,
      recoveryLogs: findRecoveryLogsByUserId(user.id),
      sessions: findWorkoutSessionsByUserId(user.id),
      todayISO: new Date().toISOString().slice(0, 10),
    }).display;
  }

  return (
    <section className="space-y-8">
      <PageHeader
        eyebrow="Club"
        title="Messages"
        subtitle="Ask the AI assistant, or message your coach directly."
      />

      <MessagesView
        aiMessages={aiMessages}
        coachMessages={coachMessages}
        aiConfigured={isAiConfigured()}
        aiContext={aiContext}
        initialPrompt={initialPrompt}
        fallbackDrinkSettings={profile?.drinkSettings ?? null}
      />
    </section>
  );
}
