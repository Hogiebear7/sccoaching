"use client";

import { useState } from "react";

interface FaqItem {
  question: string;
  answer: string;
}

// Grounded in the app's actual rules (cancellation cutoff, waitlist cap,
// pause durations) rather than invented policy, so nothing here contradicts
// what members experience once they sign up. A few answers (marked in the
// source) are business calls the coach should confirm/edit before launch —
// see the chat summary for which ones.
const FAQS: FaqItem[] = [
  {
    question: "Do I need experience to start?",
    answer:
      "No. Semi-Private sessions are built around your own starting point — your first session sets a baseline and shapes the block that follows, whether that's your first time lifting or you're returning to training with years of experience.",
  },
  {
    question: "Which class is right for me?",
    answer:
      "Semi-Private Personal Training suits anyone wanting individual coaching in a small group, from beginners to experienced lifters chasing a specific goal. Parent & Baby Classes are for the postnatal period, training with your baby nearby. Mature Athletes is built for older adults focused on strength, balance, and staying capable long-term. Not sure? Get in touch and we'll point you the right way.",
  },
  {
    question: "What should I bring to my first session?",
    answer:
      "Comfortable training clothes, trainers you can lift in, a towel, and water. Everything else — equipment, program, coaching — is taken care of on the floor.",
  },
  {
    question: "Can I pause my membership?",
    answer:
      "Yes. If you need a break — injury, travel, whatever — ask your coach to pause your membership for 2 weeks, 1 month, or 6 months. Billing pauses with it, and everything picks back up automatically when the pause ends.",
  },
  {
    question: "What happens if a class is full?",
    answer:
      "You can join the waitlist (up to 2 members deep per class). If a spot opens, it's offered to the first person in line with a short window to accept before it passes to the next — you'll get a notification either way.",
  },
  {
    question: "What's the cancellation policy?",
    answer:
      "Cancel at least 3 hours before a class starts and your session credit is returned automatically. Cancelling later than that forfeits the credit for that session.",
  },
  {
    question: "How much does membership cost?",
    answer:
      "Semi-Private Personal Training starts from €160/month. Parent & Baby and Mature Athletes classes start from €20/class. Every plan includes coach messaging, class booking, and full workout tracking in the app. See the Membership section above for the full breakdown.",
  },
  {
    question: "Where are you located?",
    answer: "Navan, Co. Meath. Reach out any time — details are just below.",
  },
];

export function FaqSection() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="divide-y divide-white/[0.08] border-t border-white/[0.08]">
      {FAQS.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.question}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              aria-controls={`faq-answer-${i}`}
              className="flex w-full items-center justify-between gap-4 py-5 text-left"
            >
              <span className="text-base font-medium text-zinc-100">{item.question}</span>
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className={`h-4 w-4 shrink-0 text-gold transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
              >
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>
            <div
              id={`faq-answer-${i}`}
              className={`grid overflow-hidden text-sm leading-relaxed text-zinc-400 transition-[grid-template-rows,opacity,margin] duration-200 ${
                isOpen ? "mb-5 [grid-template-rows:1fr] opacity-100" : "[grid-template-rows:0fr] opacity-0"
              }`}
            >
              <div className="min-h-0 overflow-hidden">{item.answer}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
