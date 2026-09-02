import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  createAiMessage,
  createAiRedirectEvent,
  findAiMessagesByUserId,
  findBodyWeightLogsByUserId,
  findProfileByUserId,
  findRecoveryLogsByUserId,
  findUserById,
  findWeeklyTrainingScheduleByUserId,
  findWorkoutSessionsByUserId,
  type AiMessageRecord,
} from "@/lib/db";
import { resolveBookingsForUser } from "@/lib/bookings";
import { resolveCurrentWeightKg } from "@/lib/body-weight";
import { normalizeDrinkSettings } from "@/lib/drink-settings";
import { buildCoachingContext } from "@/lib/ai-context";
import { createCoachChatStream, isAiConfigured } from "@/lib/ai";
import { hasAccess } from "@/lib/member-access";
import { resolveMemberTierForUser } from "@/lib/membership-entitlement";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyRequestSession } from "@/lib/mobile-auth";

// Spend/abuse guard: 20 messages per 5 minutes per member.
const CHAT_RATE_LIMIT = 20;
const CHAT_RATE_WINDOW_MS = 5 * 60 * 1000;

const REFUSAL_MESSAGE =
  "I can't help with that one. I'm here for training, recovery, and questions about your programme — ask me anything in that space.";

const INTERRUPTED_NOTE =
  "\n\n[Connection interrupted — if this reply looks cut off, please send your message again.]";

export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, configured: false, message: "You must be signed in." },
      { status: 401 }
    );
  }

  const user = findUserById(sessionUserId);

  if (!user) {
    return NextResponse.json(
      { success: false, configured: false, message: "You must be signed in." },
      { status: 401 }
    );
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { success: false, configured: false, message: "AI chat is not available right now." },
      { status: 503 }
    );
  }

  if (!hasAccess(resolveMemberTierForUser(user.id), "aiCoachChat")) {
    return NextResponse.json(
      { success: false, configured: true, message: "AI Coach chat needs App Subscription or above." },
      { status: 403 }
    );
  }

  const rate = checkRateLimit(`ai-chat:${user.id}`, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        success: false,
        configured: true,
        message: `You're sending messages quickly — try again in about ${rate.retryAfterSecs > 60 ? `${Math.ceil(rate.retryAfterSecs / 60)} min` : `${rate.retryAfterSecs}s`}.`,
      },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSecs) } }
    );
  }

  const profile = findProfileByUserId(user.id);
  if (!profile) {
    return NextResponse.json(
      { success: false, configured: true, message: "No profile found for this account." },
      { status: 404 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, configured: true, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { content, drinkSettings } = (body ?? {}) as Record<string, unknown>;

  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json(
      { success: false, configured: true, message: "Message content is required." },
      { status: 400 }
    );
  }

  // Optional calculator settings from the client — normalized field-by-field
  // so nothing unvalidated reaches the grounding context.
  const cleanDrinkSettings =
    typeof drinkSettings === "object" && drinkSettings !== null
      ? normalizeDrinkSettings(drinkSettings)
      : null;

  const cleanContent = content.trim().slice(0, 4000);
  const now = new Date().toISOString();

  const userRecord: AiMessageRecord = {
    id: randomUUID(),
    userId: user.id,
    role: "user",
    content: cleanContent,
    createdAt: now,
  };
  createAiMessage(userRecord);

  // Grounding: strictly the signed-in member's own records. Weight resolves
  // through the body-weight log so the assistant cites the synced value.
  const context = buildCoachingContext({
    profile: {
      ...profile,
      currentWeightKg: resolveCurrentWeightKg(
        profile.currentWeightKg,
        findBodyWeightLogsByUserId(user.id)
      ),
    },
    recoveryLogs: findRecoveryLogsByUserId(user.id),
    sessions: findWorkoutSessionsByUserId(user.id),
    todayISO: new Date().toISOString().slice(0, 10),
    // Client-attached settings are freshest; fall back to the profile-synced
    // copy so grounding works on devices that never opened the calculator.
    drinkSettings: cleanDrinkSettings ?? profile.drinkSettings ?? null,
    weeklyTrainingSchedule: findWeeklyTrainingScheduleByUserId(user.id) ?? null,
    upcomingBookings: resolveBookingsForUser(user.id),
  });

  // Last 20 messages (including the one just saved) for multi-turn context.
  const turns = findAiMessagesByUserId(user.id)
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  function persistAssistant(text: string) {
    createAiMessage({
      id: randomUUID(),
      userId: user!.id,
      role: "assistant",
      content: text,
      createdAt: new Date().toISOString(),
    });
  }

  const encoder = new TextEncoder();

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let accumulated = "";
      try {
        const stream = createCoachChatStream({
          memberContext: context.text,
          turns,
        });

        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            accumulated += event.delta.text;
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }

        const final = await stream.finalMessage();

        // Opus-family safety refusals arrive as a stop reason, possibly with
        // no content — surface a friendly, on-brand line instead of silence.
        if (final.stop_reason === "refusal" || !accumulated.trim()) {
          const fallback = REFUSAL_MESSAGE;
          if (!accumulated.trim()) {
            controller.enqueue(encoder.encode(fallback));
            accumulated = fallback;
          }
        }

        // Rough, heuristic signal only (substring match on the reply, not a
        // real classifier) — durably recorded so it survives restarts and
        // can be reviewed after launch (see docs/ai-coach-routing.md and
        // scripts/ai-redirect-summary.mjs), without adding any analytics
        // infrastructure or changing behavior. Deliberately minimal: no
        // userId, no message content — see AiRedirectEventRecord. See the
        // Nutrition Coach route for the symmetric signal in the other
        // direction.
        if (/nutrition (coach|tab)/i.test(accumulated)) {
          createAiRedirectEvent({
            id: randomUUID(),
            direction: "coach_to_nutrition",
            createdAt: new Date().toISOString(),
          });
        }

        persistAssistant(accumulated);
        controller.close();
      } catch (err) {
        console.error("AI chat stream failed:", err);
        if (accumulated.trim()) {
          // Persist exactly what the member saw, including the note.
          accumulated += INTERRUPTED_NOTE;
          controller.enqueue(encoder.encode(INTERRUPTED_NOTE));
          persistAssistant(accumulated);
          controller.close();
        } else {
          controller.error(err);
        }
      }
    },
  });

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      // Disable proxy buffering so tokens reach the client as they stream.
      "X-Accel-Buffering": "no",
    },
  });
}
