"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

interface TourStep {
  target: string | null; // data-tour value, or null for a centered intro/outro card
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    target: null,
    title: "Welcome to your dashboard",
    body: "A quick 30-second look at where everything lives before you get started.",
  },
  {
    target: "next-session",
    title: "Your next session",
    body: "Whatever you've got booked shows here first. Nothing on the books yet? You can book straight from this card.",
  },
  {
    target: "readiness",
    title: "Readiness",
    body: "Log a daily recovery check-in and this fills in with a readiness score, your 7-day training load, sleep, and session guidance.",
  },
  {
    target: "nutrition",
    title: "Nutrition",
    body: "Log meals and hydration, and get an AI coach that already knows your goals, dietary needs, and training load.",
  },
  {
    target: "club",
    title: "Membership & your coach",
    body: "Check your plan status and message your coach directly — both live right here.",
  },
  {
    target: "quick-actions",
    title: "You're set",
    body: "Everything else — workouts, profile, settings — is one tap away from here or the nav. Have a good session.",
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;

export function DashboardTour({ initialCompleted }: { initialCompleted: boolean }) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (initialCompleted) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Still show the tour (it's informational, not decorative motion) but
      // skip the smooth-scroll travel between steps.
    }
    const timer = setTimeout(() => setActive(true), 350);
    return () => clearTimeout(timer);
  }, [initialCompleted]);

  useEffect(() => {
    if (!active) return;

    const step = STEPS[stepIndex];
    if (!step.target) {
      setRect(null);
      return;
    }

    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) {
      // Target isn't on this page (e.g. member has no relevant section) —
      // skip straight past it rather than stalling the tour.
      setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });

    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const settleTimer = setTimeout(measure, reduceMotion ? 0 : 380);

    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(settleTimer);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [active, stepIndex]);

  function finish() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setActive(false);
    void fetch("/api/profile/tour", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
  }

  if (!active) return null;

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const isFirst = stepIndex === 0;

  // Card position: centered for intro/outro steps without a rect, otherwise
  // anchored under (or over, if there's no room below) the spotlighted rect.
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 400;
  const cardWidth = Math.min(340, viewportW - 32);
  let cardStyle: CSSProperties;
  if (!rect) {
    cardStyle = {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: cardWidth,
    };
  } else {
    const spaceBelow = viewportH - (rect.top + rect.height);
    const placeBelow = spaceBelow > 200 || spaceBelow > rect.top;
    const top = placeBelow
      ? Math.min(rect.top + rect.height + PAD * 2, viewportH - 20)
      : undefined;
    const bottom = !placeBelow ? viewportH - rect.top + PAD * 2 : undefined;
    const left = Math.max(16, Math.min(rect.left, viewportW - cardWidth - 16));
    cardStyle = {
      position: "fixed",
      top,
      bottom,
      left,
      width: cardWidth,
    };
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Dashboard walkthrough"
      className="fixed inset-0 z-[200]"
    >
      {/* Dark scrim with a spotlight cutout around the current target, drawn
          via an oversized box-shadow rather than an SVG mask — simplest way
          to get a soft-edged "hole" that animates smoothly between steps. */}
      <div
        className="absolute inset-0 bg-black/10"
        style={{ pointerEvents: "auto" }}
        aria-hidden="true"
      />
      {rect && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-xl ring-2 ring-primary/70 transition-all duration-300 ease-out"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(6,8,14,0.78)",
          }}
        />
      )}
      {!rect && <div aria-hidden="true" className="fixed inset-0 bg-[rgba(6,8,14,0.78)]" />}

      <div
        className="surface-card surface-card--accent anim-rise p-5"
        style={cardStyle}
      >
        <p className="label-caps text-[9px] text-primary">
          Step {stepIndex + 1} of {STEPS.length}
        </p>
        <h3 className="text-display mt-1.5 text-[17px]">{step.title}</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">{step.body}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={finish}
            className="text-[12px] font-medium text-zinc-500 transition-colors duration-150 hover:text-zinc-300"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                type="button"
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                className="rounded-lg border border-white/[0.1] bg-white/[0.05] px-3.5 py-2 text-[13px] font-medium text-zinc-300 transition-colors duration-150 hover:bg-white/[0.08]"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? finish() : setStepIndex((i) => i + 1))}
              className="btn-primary px-4 py-2 text-[13px]"
            >
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
