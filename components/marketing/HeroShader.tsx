"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";

// WebGPU only runs in the browser, so the canvas loads client-side in its
// own chunk. Browsers without WebGPU leave the canvas transparent, which
// falls back to the page's existing CSS background.
const HeroShaderCanvas = dynamic(() => import("./HeroShaderCanvas"), { ssr: false });

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// Ambient animated backdrop for the marketing hero. Skipped entirely for
// reduced-motion visitors, who keep the static CSS background.
export function HeroShader({ className }: { className?: string }) {
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => true,
  );

  if (reducedMotion) return null;

  return (
    <div aria-hidden className={className}>
      <HeroShaderCanvas />
    </div>
  );
}
