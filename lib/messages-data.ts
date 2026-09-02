import {
  findAiMessagesByUserId,
  findMessagesByMemberId,
  findProfileByUserId,
  findRecoveryLogsByUserId,
  findUserById,
  findWeeklyTrainingScheduleByUserId,
  findWorkoutSessionsByUserId,
} from "./db";
import { resolveBookingsForUser } from "./bookings";
import { buildCoachingContext, type CoachingContextDisplay } from "./ai-context";
import { isAiConfigured } from "./ai";

export interface AiMessageSummary {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface CoachMessageSummary {
  id: string;
  senderRole: "member" | "staff";
  body: string;
  createdAt: string;
}

export interface MessagesData {
  aiMessages: AiMessageSummary[];
  coachMessages: CoachMessageSummary[];
  aiConfigured: boolean;
  aiContext: CoachingContextDisplay | null;
}

// Shared by the web Messages page (app/(dashboard)/dashboard/messages/
// page.tsx) and the mobile JSON API (app/api/mobile/messages/route.ts).
// Sending goes through the existing /api/ai/chat (AI Coach) and
// /api/messages/send (human coach) endpoints — this covers everything
// needed to render both threads on load.
export function getMessagesData(userId: string | undefined): MessagesData | null {
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return null;

  const profile = findProfileByUserId(user.id);

  let aiContext: CoachingContextDisplay | null = null;
  if (profile) {
    aiContext = buildCoachingContext({
      profile,
      recoveryLogs: findRecoveryLogsByUserId(user.id),
      sessions: findWorkoutSessionsByUserId(user.id),
      todayISO: new Date().toISOString().slice(0, 10),
      weeklyTrainingSchedule: findWeeklyTrainingScheduleByUserId(user.id) ?? null,
      upcomingBookings: resolveBookingsForUser(user.id),
    }).display;
  }

  return {
    aiMessages: findAiMessagesByUserId(user.id).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
    coachMessages: findMessagesByMemberId(user.id).map((m) => ({
      id: m.id,
      senderRole: m.senderRole,
      body: m.body,
      createdAt: m.createdAt,
    })),
    aiConfigured: isAiConfigured(),
    aiContext,
  };
}
