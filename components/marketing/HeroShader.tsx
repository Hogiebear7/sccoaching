"use client";

import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";

import { STATIC_HAZE } from "./haze";

// WebGPU only runs in the browser, so the canvas loads client-side in its
// own chunk. Browsers without WebGPU leave the canvas transparent, which
// falls back to the static haze below.
const HeroShaderCanvas = dynamic(() => import("./HeroShaderCanvas"), { ssr: false });

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

// STATIC_HAZE is the stand-in for the animated haze. It is server-rendered,
// so the hero looks finished on first paint while the shader chunk
// downloads, and it is all reduced-motion visitors see.

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
