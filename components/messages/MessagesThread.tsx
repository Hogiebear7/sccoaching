"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import type { MessageRecord } from "@/lib/db";

export function MessagesThread({
  messages,
  currentUserRole,
  memberId,
}: {
  messages: MessageRecord[];
  currentUserRole: "member" | "staff";
  memberId?: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);

  async function handleDraftWithAi() {
    if (!memberId) return;

    setAiNote(null);
    setFormError(null);
    setIsDrafting(true);

    try {
      const res = await fetch("/api/ai/draft-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setFormError(data?.message ?? "Could not draft a reply. Please try again.");
        return;
      }

      if (data.configured) {
        setBody(data.draft ?? "");
      } else {
        setAiNote(data.draft ?? "AI assistant is not configured yet.");
      }
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setIsDrafting(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!body.trim()) {
      setFormError("Message can't be empty.");
      return;
    }

    setFormError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          currentUserRole === "staff" ? { memberId, body } : { body }
        ),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setFormError(data?.message ?? "Could not send message. Please try again.");
        return;
      }

      setBody("");
      router.refresh();
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
        {messages.length === 0 ? (
          <p className="text-sm text-zinc-400">No messages yet.</p>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => {
              const isOwnRole = message.senderRole === currentUserRole;

              return (
                <div
                  key={message.id}
                  className={`flex ${isOwnRole ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-[10px] px-4 py-3 text-sm ${
                      isOwnRole
                        ? "bg-teal-500 text-black"
                        : "border border-zinc-800 bg-zinc-900 text-zinc-100"
                    }`}
                  >
                    <p>{message.body}</p>
                    <p
                      className={`mt-1 text-xs ${
                        isOwnRole ? "text-black/60" : "text-zinc-500"
                      }`}
                    >
                      {message.senderRole === "staff" ? "Coach" : "Member"} ·{" "}
                      {new Date(message.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
      >
        {formError ? (
          <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-400">
            {formError}
          </p>
        ) : null}

        {aiNote ? (
          <p className="mb-3 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm text-zinc-400">
            {aiNote}
          </p>
        ) : null}

        <div className="flex gap-3">
          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setFormError(null);
            }}
            className="min-h-[60px] flex-1 resize-y rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-teal-500"
            placeholder="Write a message…"
          />
          <div className="flex flex-col gap-2 self-end">
            {currentUserRole === "staff" && memberId ? (
              <button
                type="button"
                onClick={handleDraftWithAi}
                disabled={isDrafting}
                className="rounded-lg border border-zinc-700 px-5 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDrafting ? "Drafting…" : "Draft with AI"}
              </button>
            ) : null}
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-teal-500 px-5 py-2 text-sm font-semibold text-black transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
