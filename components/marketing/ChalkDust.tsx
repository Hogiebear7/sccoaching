"use client";

import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";

const NARROW = "(max-width: 1023px)";

function subscribeNarrow(onChange: () => void) {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const ChalkDustCanvas = dynamic(() => import("./ChalkDustCanvas"), { ssr: false });

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// The old chalk-dust haze, laid over the hero photo. A soft static mist is always there (and is all that reduced-motion visitors or
// browsers without WebGPU see); the drifting specks fade in on top once the shader is ready. The parent masks it so it is strongest on the
// dark left side and fades out as the photo gets brighter.
export function ChalkDust({ className }: { className?: string }) {
  const reducedMotion = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => true,
  );
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
  const [ready, setReady] = useState(false);

  return (
    <div aria-hidden className={className}>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: [
            `radial-gradient(40% 55% at 20% 35%, rgb(195 205 219 / ${narrow ? 0.18 : 0.14}), transparent 70%)`,
            `radial-gradient(35% 45% at 45% 75%, rgb(195 205 219 / ${narrow ? 0.12 : 0.09}), transparent 70%)`,
          ].join(", "),
        }}
      />
      {reducedMotion ? null : (
        <div className={`absolute inset-0 transition-opacity duration-1000 ease-out ${ready ? "opacity-100" : "opacity-0"}`}>
          <ChalkDustCanvas onReady={() => setReady(true)} strong={narrow} />
        </div>
      )}
    </div>
  );
}
