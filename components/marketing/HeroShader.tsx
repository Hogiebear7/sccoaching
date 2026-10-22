"use client";

import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";

// WebGPU only runs in the browser, so the canvas loads client-side in its
// own chunk. Browsers without WebGPU leave the canvas transparent, which
// falls back to the static haze below.
const HeroShaderCanvas = dynamic(() => import("./HeroShaderCanvas"), { ssr: false });

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

// Static stand-in for the animated haze, in the same colours (see
// HeroShaderCanvas's NAVY_STOPS). It is server-rendered, so the hero looks
// finished on first paint while the shader chunk downloads, and it is all
// reduced-motion visitors see.
const STATIC_HAZE: React.CSSProperties = {
  backgroundImage: [
    "radial-gradient(55% 45% at 85% 5%, rgb(90 74 44 / 0.35), transparent 70%)",
    "radial-gradient(60% 50% at 25% 30%, rgb(195 205 219 / 0.07), transparent 70%)",
    "linear-gradient(160deg, #1f3b63 0%, #142b4a 30%, #0a1526 65%, #030a16 100%)",
  ].join(", "),
};

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// Ambient backdrop for the marketing hero: the static haze always, with the
// animated shader faded in over it once its first frame is ready.
export function HeroShader({ className }: { className?: string }) {
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => true,
  );
  const [ready, setReady] = useState(false);

  return (
    <div aria-hidden className={className}>
      <div className="absolute inset-0" style={STATIC_HAZE} />
      {reducedMotion ? null : (
        <div
          className={`absolute inset-0 transition-opacity duration-1000 ease-out ${ready ? "opacity-100" : "opacity-0"}`}
        >
          <HeroShaderCanvas onReady={() => setReady(true)} />
        </div>
      )}
    </div>
  );
}
