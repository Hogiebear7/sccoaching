"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";

import {
  TOUR_STEPS as STEPS,
  isFirstStep,
  cardPlacement,
  isLastStep,
  nextFocusIndex,
  nextStepIndex,
  prevStepIndex,
  primaryActionLabel,
  tourKeyAction,
} from "@/lib/dashboard-tour";

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
  // The measured spotlight box, tagged with the step it was measured for, so a centred step (no target) or a step that has not been
  // measured yet simply has no box. Deriving it keeps the effect below free of synchronous setState.
  const [measured, setMeasured] = useState<{ index: number; rect: Rect } | null>(null);
  const finishedRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

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
    if (!step.target) return;

    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) {
      // Target isn't on this page (e.g. member has no relevant section) —
      // skip straight past it rather than stalling the tour.
      // Deferred a tick (not set synchronously in the effect body).
      const skipTimer = setTimeout(() => setStepIndex((i) => nextStepIndex(i, STEPS.length)), 0);
      return () => clearTimeout(skipTimer);
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });

    const measure = () => {
      const r = el.getBoundingClientRect();
      setMeasured({ index: stepIndex, rect: { top: r.top, left: r.left, width: r.width, height: r.height } });
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

  // Keyboard and screen-reader support. When the walkthrough opens, remember what had focus and move focus into the card; on every
  // step change put it back on the card so the new title is announced (the card is labelled by its title); when it closes, hand focus
  // back to where it came from.
  useEffect(() => {
    if (!active) return;
    if (!returnFocusRef.current) returnFocusRef.current = document.activeElement as HTMLElement | null;
    cardRef.current?.focus({ preventScroll: true });
  }, [active, stepIndex]);

  useEffect(() => {
    return () => {
      returnFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, []);

  function finish() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setActive(false);
    returnFocusRef.current?.focus?.({ preventScroll: true });
    // Best-effort: if this fails the walkthrough is simply offered again next visit, and Skip/Finish never blocks the member.
    void fetch("/api/profile/tour", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    }).catch(() => undefined);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (tourKeyAction(event.key) === "skip") {
      event.preventDefault();
      finish();
      return;
    }
    if (event.key !== "Tab") return;
    // Trap Tab inside the card: the page behind a modal dialog must not be reachable by keyboard.
    const controls = Array.from(cardRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
    const current = controls.indexOf(document.activeElement as HTMLElement);
    const next = nextFocusIndex(controls.length, current, event.shiftKey);
    if (next >= 0) {
      event.preventDefault();
      controls[next].focus();
    }
  }

  if (!active) return null;

  const step = STEPS[stepIndex];
  const rect = step.target && measured?.index === stepIndex ? measured.rect : null;
  const isLast = isLastStep(stepIndex, STEPS.length);
  const isFirst = isFirstStep(stepIndex);

  // Card position. A step with no spotlight (the intro and outro) is centred by a flex wrapper, NOT by a CSS transform: the card's entrance
  // animation (anim-rise) ends with transform: none and fill-mode both, which overrides an inline translate(-50%, -50%) and leaves the card's
  // top-left corner at the centre of the screen, with its Next button off the edge of a phone. A step with a spotlight anchors the card to it.
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 400;
  const placement = cardPlacement(rect, viewportW, viewportH, PAD);
  const cardStyle: CSSProperties =
    placement.mode === "center"
      ? { width: placement.width }
      : { position: "fixed", top: placement.top, bottom: placement.bottom, left: placement.left, width: placement.width };

  const card = (
      <div
        ref={cardRef}
        tabIndex={-1}
        className="surface-card surface-card--accent anim-rise p-5 outline-none"
        style={cardStyle}
      >
        <p className="label-caps text-[9px] text-primary" aria-live="polite">
          Step {stepIndex + 1} of {STEPS.length}
        </p>
        <h3 id={titleId} className="text-display mt-1.5 text-[17px]">{step.title}</h3>
        <p id={bodyId} className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">{step.body}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={finish}
            className="min-h-11 px-1 text-[12px] font-medium text-zinc-500 transition-colors duration-150 hover:text-zinc-300"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                type="button"
                onClick={() => setStepIndex((i) => prevStepIndex(i))}
                className="min-h-11 rounded-lg border border-white/[0.1] bg-white/[0.05] px-3.5 py-2 text-[13px] font-medium text-zinc-300 transition-colors duration-150 hover:bg-white/[0.08]"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? finish() : setStepIndex((i) => nextStepIndex(i, STEPS.length)))}
              className="btn-primary min-h-11 px-4 py-2 text-[13px]"
            >
              {primaryActionLabel(stepIndex, STEPS.length)}
            </button>
          </div>
        </div>
      </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="fixed inset-0 z-[200]"
      onKeyDown={handleKeyDown}
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

      {placement.mode === "center" ? (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center p-4">
          <div className="pointer-events-auto">{card}</div>
        </div>
      ) : (
        card
      )}
    </div>
  );
}
