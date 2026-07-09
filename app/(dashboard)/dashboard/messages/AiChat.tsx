"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";

import type { AiMessageRecord } from "@/lib/db";
import type { CoachingContextDisplay } from "@/lib/ai-context";
import {
  describeDrinkSettings,
  DRINK_SETTINGS_STORAGE_KEY,
  parseDrinkSettingsJson,
  type DrinkSettings,
} from "@/lib/drink-settings";
import { drinkDurationInfo, SPORT_DATA } from "@/lib/nutrition";

type LocalMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  pending?: boolean;
  streaming?: boolean;
};

// Coaching-led starters, shaped by today's actual state so the first tap
// is likely to produce a grounded, useful answer. Exported for tests.
export function buildSuggestedPrompts(
  context: CoachingContextDisplay | null,
  drink: DrinkSettings | null = null
): string[] {
  const prompts: string[] = [];

  if (context?.tierLabel === "Reduced session") {
    prompts.push("Why is today's session reduced?");
  } else {
    prompts.push("Why did Workout Helper choose today's session?");
  }

  if (context && context.readinessScore === null) {
    prompts.push("What does logging recovery actually change?");
  } else {
    prompts.push("Explain my readiness score");
  }

  // Drink-calculator prompts — only when settings exist, and shaped to the
  // current mode so every starter has a grounded answer waiting.
  if (drink) {
    prompts.push("Why this much salt in my drink?");
    if (SPORT_DATA[drink.sport].runMode) {
      const { mins } = drinkDurationInfo({ ...drink, bodyWeightKg: 75 });
      prompts.push(
        mins < 40
          ? "Why is no carried drink needed for my run?"
          : "How should I carry fluids on this run?"
      );
    } else {
      prompts.push("Why this bottle size for match day?");
    }
  } else {
    prompts.push("How hard should I push today?");
  }

  if (context && context.sessionCount > 0) {
    prompts.push("When should I add weight to my main lifts?");
  } else {
    prompts.push("How should I pick weights with no training history?");
  }

  if (!drink) prompts.push("I only have 20 minutes — what should I prioritise?");

  return prompts.slice(0, 6);
}

function tierChipClass(tierLabel: string): string {
  if (tierLabel === "Full session") return "border-teal-500/25 bg-teal-500/[0.08] text-teal-300";
  if (tierLabel === "Reduced session") return "border-amber-500/25 bg-amber-500/[0.08] text-amber-300";
  return "border-white/[0.1] bg-white/[0.05] text-zinc-300";
}

function readinessDot(score: number | null): string {
  if (score === null) return "bg-zinc-500";
  if (score >= 75) return "bg-teal-400";
  if (score >= 50) return "bg-zinc-300";
  return "bg-amber-400";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// Subscribe to the saved drink settings so the chip stays in sync when the
// member changes them in another tab (storage event) or returns to this one
// (focus). useSyncExternalStore keeps this hydration-safe: the server
// snapshot is null, and the raw string snapshot only changes when the stored
// value actually changes, so focus events don't cause render churn.
function subscribeToDrinkSettings(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === DRINK_SETTINGS_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", onChange);
  };
}

function getDrinkSettingsSnapshot(): string | null {
  return window.localStorage.getItem(DRINK_SETTINGS_STORAGE_KEY);
}

function getDrinkSettingsServerSnapshot(): string | null {
  return null;
}

export function AiChat({
  initialMessages,
  configured,
  context,
  initialPrompt = null,
  fallbackDrinkSettings = null,
}: {
  initialMessages: AiMessageRecord[];
  configured: boolean;
  context: CoachingContextDisplay | null;
  initialPrompt?: string | null;
  /** Profile-synced drink settings, used when this device has none stored. */
  fallbackDrinkSettings?: DrinkSettings | null;
}) {
  const [messages, setMessages] = useState<LocalMsg[]>(initialMessages);
  // Handoffs from other tabs (e.g. Nutrition) prefill the composer; the
  // member reviews and sends — nothing fires automatically.
  const [input, setInput] = useState(initialPrompt ?? "");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stable key per pending send. Retained on failure so a retry replaces the
  // same slot rather than appending a duplicate optimistic message.
  const [pendingKey, setPendingKey] = useState(() => crypto.randomUUID());
  // Saved drink-calculator settings, kept in sync across tabs and on focus.
  const drinkSettingsRaw = useSyncExternalStore(
    subscribeToDrinkSettings,
    getDrinkSettingsSnapshot,
    getDrinkSettingsServerSnapshot
  );
  const drinkSettings = useMemo<DrinkSettings | null>(
    () => parseDrinkSettingsJson(drinkSettingsRaw) ?? fallbackDrinkSettings,
    [drinkSettingsRaw, fallbackDrinkSettings]
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view while streaming.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (!configured) {
    return (
      <div className="panel p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[10px] border border-white/[0.07] bg-white/[0.03] text-zinc-500">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
            <path d="M12 3a7 7 0 0 0-7 7c0 2.1.93 4.09 2.54 5.43V19a2 2 0 0 0 2 2h4.92a2 2 0 0 0 2-2v-3.57A7 7 0 0 0 19 10a7 7 0 0 0-7-7z" />
            <path d="M9.5 21h5" />
          </svg>
        </div>
        <p className="text-sm font-semibold tracking-tight text-zinc-200">AI coach unavailable</p>
        <p className="mx-auto mt-2 max-w-[320px] text-[13px] leading-relaxed text-zinc-500">
          The AI assistant isn&apos;t configured on this server yet. Use the{" "}
          <span className="font-medium text-zinc-300">Message coach</span> tab to contact your
          coach directly.
        </p>
      </div>
    );
  }

  async function sendMessage(content: string) {
    if (!content || isSending) return;

    setError(null);

    // Optimistic user message; stable key so retries replace the same slot.
    setMessages((prev) => [
      ...prev.filter((m) => !m.pending && !m.streaming),
      { id: pendingKey, role: "user", content, createdAt: new Date().toISOString(), pending: true },
    ]);
    setInput("");
    setIsSending(true);

    const streamingId = `${pendingKey}-a`;

    try {
      // Include the member's saved drink-calculator settings (if any) so the
      // coach can explain their actual mix, bottle size, and carry advice.
      const drinkSettings = parseDrinkSettingsJson(
        window.localStorage.getItem(DRINK_SETTINGS_STORAGE_KEY)
      );

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, ...(drinkSettings ? { drinkSettings } : {}) }),
      });

      const contentType = res.headers.get("content-type") ?? "";

      if (!res.ok || contentType.includes("application/json")) {
        const data = await res.json().catch(() => null);
        setMessages((prev) => prev.filter((m) => m.id !== pendingKey));
        setInput(content);
        if (res.status === 429) {
          // Specific rate-limit message; prefer the server copy, fall back
          // to the Retry-After header if the body was unreadable.
          const retryAfter = Number(res.headers.get("retry-after"));
          setError(
            data?.message ??
              `You're sending messages quickly — try again in ${
                Number.isFinite(retryAfter) && retryAfter > 0 ? `about ${retryAfter}s` : "a few minutes"
              }.`
          );
        } else {
          setError(data?.message ?? "Could not get a reply. Please try again.");
        }
        return; // pendingKey unchanged — retry reuses the slot
      }

      // Streaming path: commit the user message, open an assistant bubble,
      // and append text as it arrives.
      const now = new Date().toISOString();
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== pendingKey),
        { id: `${pendingKey}-u`, role: "user", content, createdAt: now },
        { id: streamingId, role: "assistant", content: "", createdAt: now, streaming: true },
      ]);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        setMessages((prev) =>
          prev.map((m) => (m.id === streamingId ? { ...m, content: m.content + chunk } : m))
        );
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === streamingId ? { ...m, streaming: false } : m))
      );
      setPendingKey(crypto.randomUUID());
    } catch {
      // If the stream died after partial output, keep what arrived; otherwise
      // restore the input for a clean retry.
      setMessages((prev) => {
        const streamed = prev.find((m) => m.id === streamingId);
        if (streamed && streamed.content.trim()) {
          return prev.map((m) => (m.id === streamingId ? { ...m, streaming: false } : m));
        }
        setInput(content);
        return prev.filter((m) => m.id !== pendingKey && m.id !== streamingId);
      });
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSending(false);
    }
  }

  function handleSend(e: FormEvent) {
    e.preventDefault();
    void sendMessage(input.trim());
  }

  return (
    <div className="panel overflow-hidden">
      {/* Header */}
      <div className="relative border-b border-white/[0.06] p-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(70%_100%_at_25%_0%,rgba(45,212,191,0.07),transparent)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-teal-500/25 bg-teal-500/10">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5 text-teal-300">
                <path d="M12 3a7 7 0 0 0-7 7c0 2.1.93 4.09 2.54 5.43V19a2 2 0 0 0 2 2h4.92a2 2 0 0 0 2-2v-3.57A7 7 0 0 0 19 10a7 7 0 0 0-7-7z" />
                <path d="M9.5 21h5" />
              </svg>
            </div>
            <div>
              <p className="text-display text-[15px] text-zinc-50">AI Coach</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Answers grounded in your recovery, load, and training history.
              </p>
            </div>
          </div>

          {(context || drinkSettings) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {context && (
                <>
                  <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold ${tierChipClass(context.tierLabel)}`}>
                    Today · {context.tierLabel}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-300">
                    <span className={`h-1.5 w-1.5 rounded-full ${readinessDot(context.readinessScore)}`} />
                    Readiness <span className="tabular-nums">{context.readinessScore ?? "—"}</span>
                    {context.readinessDelta != null && context.readinessDelta !== 0 && (
                      <span
                        className={`tabular-nums ${context.readinessDelta > 0 ? "text-teal-300" : "text-amber-300"}`}
                      >
                        {context.readinessDelta > 0 ? "▲" : "▼"}{Math.abs(context.readinessDelta)}
                      </span>
                    )}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-300">
                    Load <span className="text-zinc-400">{context.loadBandLabel}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-300">
                    <span className="tabular-nums">{context.sessionCount}</span>
                    <span className="text-zinc-400">workout{context.sessionCount === 1 ? "" : "s"}</span>
                  </span>
                </>
              )}
              {drinkSettings && (
                <Link
                  href="/dashboard/nutrition"
                  title="Open the drink calculator in Nutrition"
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-[border-color,background-color,color] duration-150 hover:border-teal-500/30 hover:bg-teal-500/[0.06] hover:text-teal-300"
                >
                  Drink <span className="text-zinc-400 tabular-nums">{describeDrinkSettings(drinkSettings)}</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-2.5 w-2.5 text-zinc-500">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Conversation */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        className="max-h-[480px] space-y-3 overflow-y-auto p-5"
      >
        {messages.length === 0 ? (
          <div className="py-6 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-[10px] border border-white/[0.07] bg-white/[0.03] text-zinc-500 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-sm font-semibold tracking-tight text-zinc-200">
              Ask your coach anything
            </p>
            <p className="mx-auto mt-1.5 max-w-[300px] text-[13px] leading-relaxed text-zinc-500">
              Answers use your real recovery, load, and training history — nothing generic.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-1.5">
              {buildSuggestedPrompts(context, drinkSettings).map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={isSending}
                  onClick={() => void sendMessage(prompt)}
                  className="rounded-full border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-400 transition-[border-color,background-color,color,transform] duration-150 hover:border-teal-500/30 hover:bg-teal-500/[0.06] hover:text-teal-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === "user";
            return (
              <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-[10px] px-4 py-3 text-sm leading-relaxed ${
                    isUser
                      ? `rounded-br-md bg-teal-500 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] ${msg.pending ? "opacity-70" : ""}`
                      : "rounded-bl-md border border-white/[0.05] bg-white/[0.05] text-zinc-100"
                  }`}
                >
                  <p className="whitespace-pre-wrap">
                    {msg.content}
                    {msg.streaming && (
                      <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse rounded-full bg-teal-300 align-middle" />
                    )}
                  </p>
                  {!msg.streaming && (
                    <p className={`mt-1.5 text-[10px] tabular-nums ${isUser ? "text-white/60" : "text-zinc-500"}`}>
                      {isUser ? "You" : "AI Coach"}
                      {formatTime(msg.createdAt) ? ` · ${formatTime(msg.createdAt)}` : ""}
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* Waiting indicator before the first token arrives */}
        {isSending && !messages.some((m) => m.streaming) && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-[10px] rounded-bl-md border border-white/[0.05] bg-white/[0.05] px-4 py-3">
              <span className="flex items-center gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-400/70"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </span>
              <span className="text-xs text-zinc-500">Checking your logs…</span>
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <form onSubmit={handleSend} className="border-t border-white/[0.06] p-4">
        {error ? (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5">
            <p className="text-sm text-destructive">{error}</p>
            {input.trim() && !isSending && (
              <button
                type="button"
                onClick={() => void sendMessage(input.trim())}
                className="shrink-0 rounded-lg border border-white/[0.1] bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-zinc-200 transition-colors duration-150 hover:bg-white/[0.08]"
              >
                Try again
              </button>
            )}
          </div>
        ) : null}

        <div className="flex gap-2.5">
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            rows={2}
            className="input-field min-h-[52px] flex-1 resize-y"
            placeholder="Ask about training, recovery, or today's session…"
          />
          <button
            type="submit"
            disabled={isSending || !input.trim()}
            className="self-end rounded-lg border border-teal-400/50 bg-teal-500 px-4 py-2.5 text-[13px] font-bold uppercase tracking-[0.08em] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18)] transition-[background-color,transform] duration-150 hover:bg-teal-400 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 disabled:active:translate-y-0"
          >
            {isSending ? "…" : "Send"}
          </button>
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-600">
          General coaching guidance based on your logs — not medical advice. For pain or injury,
          speak to a qualified professional.
        </p>
      </form>
    </div>
  );
}
