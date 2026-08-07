import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  createAiMessage,
  createAiRedirectEvent,
  findAiMessagesByUserId,
  findProfileByUserId,
  findRecoveryLogsByUserId,
  findUserById,
  type AiMessageRecord,
} from "@/lib/db";
import { resolveBookingsForUser } from "@/lib/bookings";
import { normalizeDrinkSettings } from "@/lib/drink-settings";
import { buildNutritionCoachContext } from "@/lib/ai-context";
import { createNutritionCoachChatStream, isAiConfigured } from "@/lib/ai";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { EXERTION_LABEL, type Exertion } from "@/lib/nutrition";

// Same spend/abuse guard shape as the general AI Coach, kept in its own key
// namespace so the two features don't share a budget.
const CHAT_RATE_LIMIT = 20;
const CHAT_RATE_WINDOW_MS = 5 * 60 * 1000;

const REFUSAL_MESSAGE =
  "I can't help with that one. I'm here for meal and fuelling guidance — ask me anything in that space.";

const INTERRUPTED_NOTE =
  "\n\n[Connection interrupted — if this reply looks cut off, please send your message again.]";

const VALID_EXERTIONS: Exertion[] = Object.keys(EXERTION_LABEL) as Exertion[];

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
      { success: false, configured: false, message: "AI Nutrition Coach is not available right now." },
      { status: 503 }
    );
  }

  const rate = checkRateLimit(`ai-nutrition-coach:${user.id}`, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS);
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

  const { content, tomorrow, drinkSettings } = (body ?? {}) as Record<string, unknown>;

  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json(
      { success: false, configured: true, message: "Message content is required." },
      { status: 400 }
    );
  }

  // Tomorrow's planned exertion is a client-side selection on the Nutrition
  // tab, not a server record (see NutritionView.tsx) — validate against the
  // known set rather than trusting an arbitrary string.
  const cleanTomorrow: Exertion =
    typeof tomorrow === "string" && VALID_EXERTIONS.includes(tomorrow as Exertion)
      ? (tomorrow as Exertion)
      : "medium";

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
    channel: "nutrition",
  };
  createAiMessage(userRecord);

  // Grounding: strictly the signed-in member's own records — same
  // discipline as the general coach's buildCoachingContext.
  const context = buildNutritionCoachContext({
    profile,
    recoveryLogs: findRecoveryLogsByUserId(user.id),
    todayISO: new Date().toISOString().slice(0, 10),
    tomorrow: cleanTomorrow,
    upcomingBookings: resolveBookingsForUser(user.id),
    drinkSettings: cleanDrinkSettings ?? profile.drinkSettings ?? null,
  });

  // Last 20 messages on THIS channel only — the general AI Coach thread
  // stays separate (see findAiMessagesByUserId's channel filter).
  const turns = findAiMessagesByUserId(user.id, "nutrition")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  function persistAssistant(text: string) {
    createAiMessage({
      id: randomUUID(),
      userId: user!.id,
      role: "assistant",
      content: text,
      createdAt: new Date().toISOString(),
      channel: "nutrition",
    });
  }

  const encoder = new TextEncoder();

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let accumulated = "";
      try {
        const stream = createNutritionCoachChatStream({
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

        if (final.stop_reason === "refusal" || !accumulated.trim()) {
          const fallback = REFUSAL_MESSAGE;
          if (!accumulated.trim()) {
            controller.enqueue(encoder.encode(fallback));
            accumulated = fallback;
          }
        }

        // Symmetric heuristic to the general AI Coach route's redirect event
        // — a rough substring signal, not a classifier. "Messages" is the
        // distinguishing term since this coach describes itself as living in
        // the Nutrition tab, never in Messages. Durably recorded for the same
        // reasons as the other direction — see AiRedirectEventRecord.
        if (/\bmessages\b/i.test(accumulated)) {
          createAiRedirectEvent({
            id: randomUUID(),
            direction: "nutrition_to_coach",
            createdAt: new Date().toISOString(),
          });
        }

        persistAssistant(accumulated);
        controller.close();
      } catch (err) {
        console.error("AI nutrition coach stream failed:", err);
        if (accumulated.trim()) {
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
      "X-Accel-Buffering": "no",
    },
  });
}
