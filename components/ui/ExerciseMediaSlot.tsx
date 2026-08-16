"use client";

// GIF-forward media slot for the exercise library, modeled directly on
// ClassImageSlot.tsx's placeholder/real-image split — same deterministic
// on-brand fallback when there's no media yet, same "plain <img>, not
// next/image" reasoning (GIF animation can't be optimized by next/image
// anyway). Adds a skeleton overlay while the GIF itself is still loading,
// since these files are meaningfully larger than the class-cover images
// that component was built for, and a blank flash on a member's connection
// would read as broken rather than loading.

import { useState } from "react";

function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return 228 + (h % 40);
}

export function ExerciseMediaSlot({
  seed,
  name,
  gifUrl,
  className,
}: {
  /** Stable string (exercise id/slug) → picks the placeholder hue. */
  seed: string;
  name: string;
  gifUrl?: string | null;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const hue = hueFor(seed);
  const showPlaceholder = !gifUrl || errored;

  return (
    <div className={`relative overflow-hidden ${className ?? ""}`}>
      {!showPlaceholder ? (
        <>
          {!loaded ? <div className="skeleton absolute inset-0" /> : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={gifUrl}
            alt={`${name} demonstration`}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
            loading="lazy"
          />
        </>
      ) : (
        <div aria-hidden className="absolute inset-0">
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(135deg, oklch(0.24 0.05 ${hue}) 0%, oklch(0.16 0.03 ${hue}) 58%, oklch(0.12 0.02 ${(hue + 24) % 360}) 100%)`,
            }}
          />
          <div
            className="absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "linear-gradient(oklch(1 0 0 / 0.6) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0 / 0.6) 1px, transparent 1px)",
              backgroundSize: "22px 22px",
            }}
          />
          <div className="absolute -right-5 top-0 h-full w-14 -skew-x-[18deg] bg-primary/[0.14]" />
          <div className="absolute right-2 top-0 h-full w-1.5 -skew-x-[18deg] bg-primary/60" />
          <svg
            viewBox="0 0 24 24"
            fill="none"
            style={{ stroke: "var(--primary)" }}
            strokeWidth={1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute -bottom-3 left-3 h-20 w-20 opacity-15"
          >
            {/* dumbbell */}
            <path d="M4 9v6M2 10.5v3M7 7v10M17 7v10M22 10.5v3M20 9v6M7 12h10" />
          </svg>
        </div>
      )}
    </div>
  );
}
