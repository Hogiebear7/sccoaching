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
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-4 py-6 md:px-6">
        <header className="mb-6">
          <p className="text-sm text-neutral-400">Coach</p>
          <h1 className="text-3xl font-semibold">AI Coach</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-300">
            Ask about workouts, recovery, food, or planning your week.
          </p>
        </header>

        <section className="mb-4 flex flex-wrap gap-2">
          {starterPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => sendMessage(prompt)}
              className="rounded-full border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-200 transition hover:bg-neutral-800"
            >
              {prompt}
            </button>
          ))}
        </section>

        <section
          aria-label="Conversation"
          className="flex-1 space-y-4 rounded-3xl border border-neutral-800 bg-neutral-900/70 p-4"
        >
          {messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                message.role === "user"
                  ? "ml-auto bg-cyan-500 text-black"
                  : "bg-neutral-800 text-neutral-100"
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
            className="flex-1 rounded-2xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-neutral-500"
            aria-label="Message the AI coach"
          />
          <button
            type="submit"
            disabled={!canSend}
            className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-medium text-black transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </main>
  );
}