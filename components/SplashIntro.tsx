"use client";

import { useEffect, useState } from "react";

const SESSION_KEY = "sc-splash-shown";
const HOLD_MS = 2000;
const TRAVEL_MS = 800;

// Brand splash: the full wordmark appears centered on first load, holds for
// ~2s, then floats into a corner while the overlay fades — revealing the
// page (which already has its own header logo in place) underneath. Shown
// once per browser tab session, not on every internal navigation — this
// lives in the root layout, which stays mounted across route changes, so a
// sessionStorage flag is what keeps it from replaying on every link click.
export function SplashIntro() {
  const [phase, setPhase] = useState<"hidden" | "center" | "traveling" | "done">("hidden");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(SESSION_KEY)) {
      setPhase("done");
      return;
    }
    sessionStorage.setItem(SESSION_KEY, "1");

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setPhase("done");
      return;
    }

    setPhase("center");
    const holdTimer = setTimeout(() => setPhase("traveling"), HOLD_MS);
    const doneTimer = setTimeout(() => setPhase("done"), HOLD_MS + TRAVEL_MS);
    return () => {
      clearTimeout(holdTimer);
      clearTimeout(doneTimer);
    };
  }, []);

  if (phase === "hidden" || phase === "done") return null;

  const traveling = phase === "traveling";

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[999] flex items-center justify-center"
      style={{
        backgroundColor: "#0a0f1a",
        opacity: traveling ? 0 : 1,
        transition: `opacity ${TRAVEL_MS}ms ease-in-out`,
        pointerEvents: "none",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- one-shot decorative splash, next/image's overhead isn't worth it here */}
      <img
        src="/brand/website-logo-v2.png"
        alt=""
        style={{
          position: "fixed",
          width: "min(60vw, 320px)",
          transformOrigin: "top left",
          transition: `top ${TRAVEL_MS}ms cubic-bezier(0.4, 0, 0.2, 1), left ${TRAVEL_MS}ms cubic-bezier(0.4, 0, 0.2, 1), transform ${TRAVEL_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
          ...(traveling
            ? { top: 20, left: 20, transform: "scale(0.22)" }
            : { top: "50%", left: "50%", transform: "translate(-50%, -50%) scale(1)" }),
        }}
      />
    </div>
  );
}
