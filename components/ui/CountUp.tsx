"use client";

import { useEffect, useRef, useState } from "react";

// Animated numeric readout: server renders the final value (correct without
// JS), then the mounted client counts up from 0 once with an ease-out curve.
// prefers-reduced-motion skips the animation entirely. Width is reserved via
// tabular numerals + min-width so siblings never shift while counting.
export function CountUp({
  value,
  decimals = 0,
  durationMs = 500,
}: {
  value: number;
  decimals?: number;
  durationMs?: number;
}) {
  const [display, setDisplay] = useState(value);
  const started = useRef(false);

  useEffect(() => {
    let raf = 0;

    if (started.current) {
      // Value changed after the entrance (e.g. router.refresh) — snap, don't
      // re-run the entrance animation.
      raf = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(raf);
    }
    started.current = true;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const startTime = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Number((value * eased).toFixed(decimals)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, decimals, durationMs]);

  return (
    <span
      className="inline-block text-right tabular-nums"
      style={{ minWidth: `${value.toFixed(decimals).length}ch` }}
    >
      {display.toFixed(decimals)}
    </span>
  );
}
