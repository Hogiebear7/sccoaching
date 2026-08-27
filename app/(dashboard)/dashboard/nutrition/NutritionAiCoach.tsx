"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import type { AiMessageRecord } from "@/lib/db";
import type { NutritionCoachContextDisplay } from "@/lib/ai-context";
import type { DrinkSettings } from "@/lib/drink-settings";
import { EXERTION_LABEL, type Exertion } from "@/lib/nutrition";
import { extractTargetProposal, type TargetProposal } from "@/lib/nutrition-target-proposal";
import { IconBadge } from "@/components/graphics/IconBadge";

type LocalMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  pending?: boolean;
  streaming?: boolean;
};

// Coaching-led starters, shaped by today's actual fuel day and what's
// coming up so the first tap produces a grounded, useful answer. Exported
// for tests, matching the pattern already used by AiChat's suggested prompts.
export function buildNutritionSuggestedPrompts(
  context: NutritionCoachContextDisplay | null,
  tomorrow: Exertion
): string[] {
  const prompts: string[] = ["What should I eat before training today?"];

  if (context?.fuelDay === "match" || context?.fuelDay === "full") {
    prompts.push("Best post-training meal for today?");
  } else {
    prompts.push("Post-training snack ideas");
  }

  if (context?.nextSession) {
    // Grounded in a real booking — never a guess at what "next" means.
    prompts.push(`How should I fuel for ${context.nextSession.title}?`);
  } else if (tomorrow === "match" || tomorrow === "high") {
    prompts.push("What should I eat today to prep for tomorrow's session?");
  } else {
    // No urgent next session to plan around — a still-practical default
    // rather than a low-stakes near-duplicate of the prompt above.
    prompts.push("What's a simple lunch that hits today's targets?");
  }

  prompts.push("Give me a swap that still hits today's carb target");
  prompts.push("Plan my meals for the week ahead");

  return prompts.slice(0, 5);
}

function fuelChipClass(fuelDay: string | undefined): string {
  if (fuelDay === "match") return "border-gold/30 bg-gold/[0.08] text-gold";
  if (fuelDay === "full") return "border-[var(--success)]/30 bg-[var(--success-weak)] text-[var(--success)]";
  if (fuelDay === "reduced") return "border-[var(--warning)]/30 bg-[var(--warning-weak)] text-[var(--warning)]";
  return "border-white/[0.1] bg-white/[0.04] text-zinc-300";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function CoachIcon({ className = "h-4 w-4" }: { className?: string }) {
  // Fork/plate mark — distinct from the Messages AI Coach's head-outline
  // icon, so the two premium-AI surfaces read as related but not identical.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path d="M7 3v7a1 1 0 0 0 1 1h0a1 1 0 0 0 1-1V3" />
      <path d="M9 11v10" />
      <path d="M16 3c-1.5 1.2-2 3-2 5s.5 3.8 2 5c1.5-1.2 2-3 2-5s-.5-3.8-2-5z" />
      <path d="M16 13v8" />
    </svg>
  );
}

export function NutritionAiCoach({
  initialMessages,
  configured,
  context,
  tomorrow,
  drinkSettings = null,
  open,
  onOpenChange,
  prefillPrompt,
  onPrefillConsumed,
  onTargetApplied,
}: {
  initialMessages: AiMessageRecord[];
  configured: boolean;
  context: NutritionCoachContextDisplay | null;
  /** Client-side "tomorrow" selection from NutritionView — the same state
      that drives the tab's own fuel-day numbers. */
  tomorrow: Exertion;
  drinkSettings?: DrinkSettings | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A prompt handed off from elsewhere on the tab (e.g. the drink plan) —
      applied once, then cleared via onPrefillConsumed. */
  prefillPrompt: string | null;
  onPrefillConsumed: () => void;
  /** Called after the member confirms a proposed target via the "Apply
      this target" button, so the tab's own hero card refetches and shows
      the new number immediately. */
  onTargetApplied?: () => void;
}) {
  const [messages, setMessages] = useState<LocalMsg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState(() => crypto.randomUUID());
  const [applyingMsgId, setApplyingMsgId] = useState<string | null>(null);
  const [appliedMsgIds, setAppliedMsgIds] = useState<Set<string>>(new Set());
  const [applyError, setApplyError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  async function applyProposal(msgId: string, proposal: TargetProposal) {
    setApplyingMsgId(msgId);
    setApplyError(null);
    try {
      const res = await fetch("/api/mobile/nutrition/target/member-override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proposal),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setApplyError(data?.message ?? "Could not apply that target. Please try again.");
        return;
      }
      setAppliedMsgIds((prev) => new Set(prev).add(msgId));
      onTargetApplied?.();
    } catch {
      setApplyError("Could not apply that target. Please try again.");
    } finally {
      setApplyingMsgId(null);
    }
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Apply a handed-off prompt once, then scroll the panel into view — the
  // member reviews and sends, nothing fires automatically.
  useEffect(() => {
    if (!open || !prefillPrompt) return;
    setInput(prefillPrompt);
    onPrefillConsumed();
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open, prefillPrompt, onPrefillConsumed]);

  async function sendMessage(content: string) {
    if (!content || isSending) return;

    setError(null);
    setMessages((prev) => [
      ...prev.filter((m) => !m.pending && !m.streaming),
      { id: pendingKey, role: "user", content, createdAt: new Date().toISOString(), pending: true },
    ]);
    setInput("");
    setIsSending(true);

    const streamingId = `${pendingKey}-a`;

    try {
      const res = await fetch("/api/ai/nutrition-coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, tomorrow, ...(drinkSettings ? { drinkSettings } : {}) }),
      });

      const contentType = res.headers.get("content-type") ?? "";

      if (!res.ok || contentType.includes("application/json")) {
        const data = await res.json().catch(() => null);
        setMessages((prev) => prev.filter((m) => m.id !== pendingKey));
        setInput(content);
        if (res.status === 429) {
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
        return;
      }

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

      setMessages((prev) => prev.map((m) => (m.id === streamingId ? { ...m, streaming: false } : m)));
      setPendingKey(crypto.randomUUID());
    } catch {
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

  // Collapsed state — a distinct, premium-styled entry point rather than a
  // plain outbound link. Keeps the base tab exactly as scannable as before
  // for members who never open it.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="surface-card surface-card--accent hover-lift group flex w-full items-center gap-4 p-4 text-left"
      >
        <IconBadge tone="gold" size="md">
          <CoachIcon />
        </IconBadge>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold tracking-tight text-zinc-100">AI Nutrition Coach</p>
            <span className="rounded-full border border-gold/30 bg-gold/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold">
              New
            </span>
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            What to eat today, before or after training, and on match day — built around your
            real targets and dietary needs.
          </p>
        </div>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-4 w-4 flex-shrink-0 text-zinc-600 transition-transform duration-150 group-hover:translate-x-0.5"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    );
  }

  return (
    <div ref={panelRef} className="panel overflow-hidden">
      {/* Header */}
      <div className="relative border-b border-white/[0.06] p-5">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-24"
          style={{ background: "radial-gradient(70% 100% at 25% 0%, color-mix(in oklch, var(--gold) 8%, transparent), transparent)" }}
        />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <IconBadge tone="gold" size="md">
              <CoachIcon />
            </IconBadge>
            <div>
              <p className="text-display text-[15px] text-zinc-50">AI Nutrition Coach</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Practical meal ideas — built from today&apos;s fuel targets and your dietary profile.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-200"
          >
            Hide
          </button>
        </div>

        {context && (
          <div className="relative mt-3 flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${fuelChipClass(context.fuelDay ?? undefined)}`}>
              Today · {context.fuelDayLabel}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-300 tabular-nums">
              {context.carbGramsDay}g carbs
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-300">
              Week <span className="text-zinc-400">{context.weekBandLabel}</span>
            </span>
            {context.nextSession && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-300">
                Next: <span className="text-zinc-400">{context.nextSession.title}</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.05] px-2.5 py-1 text-[11px] font-medium text-gold">
              Tomorrow <span className="tabular-nums">{EXERTION_LABEL[tomorrow]}</span>
            </span>
          </div>
        )}
      </div>

      {!configured ? (
        <div className="p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[10px] border border-white/[0.07] bg-white/[0.03] text-zinc-500">
            <CoachIcon className="h-5 w-5" />
          </div>
          <p className="text-sm font-semibold tracking-tight text-zinc-200">AI Nutrition Coach unavailable</p>
          <p className="mx-auto mt-2 max-w-[320px] text-[13px] leading-relaxed text-zinc-500">
            The AI assistant isn&apos;t configured on this server yet. Use the{" "}
            <span className="font-medium text-zinc-300">Message coach</span> tab in Messages to
            ask your coach directly.
          </p>
        </div>
      ) : (
        <>
          {/* Conversation */}
          <div ref={scrollRef} role="log" aria-live="polite" className="max-h-[480px] space-y-3 overflow-y-auto p-5">
            {messages.length === 0 ? (
              <div className="py-6 text-center">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-[10px] border border-white/[0.07] bg-white/[0.03] text-zinc-500 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <p className="text-sm font-semibold tracking-tight text-zinc-200">Ask about today&apos;s meals</p>
                <p className="mx-auto mt-1.5 max-w-[300px] text-[13px] leading-relaxed text-zinc-500">
                  Real meal ideas, built from your fuel targets, training day, and dietary profile
                  — not generic advice.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-1.5">
                  {buildNutritionSuggestedPrompts(context, tomorrow).map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled={isSending}
                      onClick={() => void sendMessage(prompt)}
                      className="rounded-full border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-400 transition-[border-color,background-color,color,transform] duration-150 hover:border-gold/30 hover:bg-gold/[0.06] hover:text-gold active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => {
                const isUser = msg.role === "user";
                // Only a finished assistant reply can carry a real proposal —
                // a still-streaming marker line may be half-written.
                const { cleanText, proposal } =
                  !isUser && !msg.streaming ? extractTargetProposal(msg.content) : { cleanText: msg.content, proposal: null };
                const applied = appliedMsgIds.has(msg.id);
                return (
                  <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-[10px] px-4 py-3 text-sm leading-relaxed ${
                        isUser
                          ? `rounded-br-md bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)] ${msg.pending ? "opacity-70" : ""}`
                          : "rounded-bl-md border border-white/[0.05] bg-white/[0.05] text-zinc-100"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">
                        {cleanText}
                        {msg.streaming && (
                          <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse rounded-full bg-gold align-middle" />
                        )}
                      </p>
                      {!msg.streaming && (
                        <p className={`mt-1.5 text-[10px] tabular-nums ${isUser ? "text-primary-foreground/70" : "text-zinc-500"}`}>
                          {isUser ? "You" : "AI Nutrition Coach"}
                          {formatTime(msg.createdAt) ? ` · ${formatTime(msg.createdAt)}` : ""}
                        </p>
                      )}
                      {proposal && (
                        <div className="mt-3 border-t border-white/[0.08] pt-3">
                          <p className="text-[11px] text-zinc-400">
                            {proposal.calories} kcal · {proposal.proteinG}g protein · {proposal.carbsG}g carbs ·{" "}
                            {proposal.fatG}g fat
                          </p>
                          <button
                            type="button"
                            disabled={applied || applyingMsgId === msg.id}
                            onClick={() => void applyProposal(msg.id, proposal)}
                            className="mt-2 rounded-lg border border-gold/30 bg-gold/[0.08] px-3 py-1.5 text-xs font-semibold text-gold transition-colors duration-150 hover:bg-gold/[0.14] disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {applied ? "Target applied" : applyingMsgId === msg.id ? "Applying…" : "Apply this target"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {applyError && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-[10px] rounded-bl-md border border-destructive/30 bg-destructive/10 px-4 py-2.5">
                  <p className="text-xs text-destructive">{applyError}</p>
                </div>
              </div>
            )}

            {isSending && !messages.some((m) => m.streaming) && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-[10px] rounded-bl-md border border-white/[0.05] bg-white/[0.05] px-4 py-3">
                  <span className="flex items-center gap-1">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold/70"
                        style={{ animationDelay: `${i * 150}ms` }}
                      />
                    ))}
                  </span>
                  <span className="text-xs text-zinc-500">Checking today&apos;s targets…</span>
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
                placeholder="Ask about today's meals, pre/post-training fuel, or match day…"
              />
              <button
                type="submit"
                disabled={isSending || !input.trim()}
                className="self-end btn-primary px-4 py-2.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:translate-y-0"
              >
                {isSending ? "…" : "Send"}
              </button>
            </div>
            <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-600">
              General nutrition guidance based on your logs and profile — not medical or dietetic
              advice. For coeliac, allergy, or other medical dietary needs, speak to a qualified
              professional.
            </p>
          </form>
        </>
      )}
    </div>
  );
}
