"use client";

import { useMemo, useState } from "react";

type Message = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

const starterPrompts = [
  "Plan my workouts for this week.",
  "What should I do on my recovery day?",
  "Help me adjust my calories for training.",
  "How should I fuel before a morning session?",
];

const assistantReplies: Record<string, string> = {
  workouts:
    "For this week, aim for 3 strength sessions, 2 cardio sessions, and 1 lighter recovery day. Keep one full rest day so your training load stays sustainable.",
  recovery:
    "On your recovery day, focus on light walking, mobility for 10 to 15 minutes, hydration, and a protein-rich meal within your normal eating pattern.",
  calories:
    "A simple starting point is to keep protein consistent, raise carbs slightly on hard training days, and reduce them a bit on lower-output days while keeping recovery strong.",
  fuel:
    "Before a morning session, try something easy to digest like a banana, toast, or yogurt 30 to 60 minutes before training, then eat a balanced meal afterward.",
  default:
    "I can help with training, recovery, scheduling, and nutrition. Tell me your goal, your weekly routine, or what feels off right now.",
};

function getAssistantReply(input: string) {
  const lower = input.toLowerCase();

  if (lower.includes("workout") || lower.includes("train") || lower.includes("week")) {
    return assistantReplies.workouts;
  }

  if (lower.includes("recovery") || lower.includes("rest") || lower.includes("sore")) {
    return assistantReplies.recovery;
  }

  if (lower.includes("calorie") || lower.includes("nutrition") || lower.includes("macro")) {
    return assistantReplies.calories;
  }

  if (lower.includes("fuel") || lower.includes("before") || lower.includes("morning")) {
    return assistantReplies.fuel;
  }

  return assistantReplies.default;
}

export default function CoachPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Hey — I’m your AI coach. I can help with training, recovery, nutrition, and weekly planning.",
    },
  ]);
  const [input, setInput] = useState("");

  const canSend = useMemo(() => input.trim().length > 0, [input]);

  function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmed,
    };

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: getAssistantReply(trimmed),
    };

    setMessages((current) => [...current, userMessage, assistantMessage]);
    setInput("");
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50">
      <div className="anim-rise mx-auto flex min-h-screen max-w-4xl flex-col px-4 py-6 md:px-6">
        <header className="mb-6">
          <p className="label-caps">Coach</p>
          <h1 className="text-display text-[26px] mt-1">AI Coach</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Ask about workouts, recovery, food, or planning your week.
          </p>
        </header>

        <section className="mb-4 flex flex-wrap gap-2">
          {starterPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => sendMessage(prompt)}
              className="rounded-full border border-white/[0.08] bg-zinc-900 px-4 py-2 text-[13px] text-zinc-300 transition-colors duration-150 hover:bg-white/[0.05] hover:text-zinc-100"
            >
              {prompt}
            </button>
          ))}
        </section>

        <section
          aria-label="Conversation"
          className="panel flex-1 space-y-4 p-4"
        >
          {messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                message.role === "user"
                  ? "ml-auto bg-gradient-to-b from-teal-500 to-teal-600 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]"
                  : "bg-white/[0.06] border border-white/[0.05] text-zinc-100"
              }`}
            >
              {message.text}
            </div>
          ))}
        </section>

        <form
          className="mt-4 flex gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            sendMessage(input);
          }}
        >
          <label htmlFor="coach-message" className="sr-only">
            Message the AI coach
          </label>
          <input
            id="coach-message"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask your coach anything..."
            className="input-field flex-1 rounded-2xl px-4 py-3"
            aria-label="Message the AI coach"
          />
          <button
            type="submit"
            disabled={!canSend}
            className="rounded-2xl border border-teal-700/60 bg-gradient-to-b from-teal-500 to-teal-600 px-5 py-3 text-sm font-medium text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_1px_2px_0_rgba(0,0,0,0.4)] transition-[background-color,transform] duration-150 hover:from-teal-400 hover:to-teal-500 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0"
          >
            Send
          </button>
        </form>
      </div>
    </main>
  );
}