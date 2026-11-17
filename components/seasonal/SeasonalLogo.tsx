"use client";

import { useSeason } from "./useSeason";

// The site logo, with a Santa hat on it while the Christmas season is on. Plain logo the rest of the year.
export function SeasonalLogo({ src = "/brand/website-logo-v2.png", width = 160, height = 74, className }: { src?: string; width?: number; height?: number; className?: string }) {
  const { season } = useSeason();
  return (
    <span className="relative inline-block leading-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" width={width} height={height} className={className} />
      {season?.hat ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 64 52"
          className="pointer-events-none absolute -left-[6%] -top-[28%] h-[58%] w-auto -rotate-[14deg] drop-shadow-sm"
        >
          <path d="M6 40 C8 18 24 4 46 6 C40 12 38 20 44 30 C48 36 52 40 56 42 Z" fill="#d6262c" />
          <path d="M6 40 C8 18 24 4 46 6 C42 9 38 14 36 20 C26 22 14 30 6 40 Z" fill="#ee4a4a" opacity="0.55" />
          <path d="M3 41 C20 37 42 38 60 45 C61 49 58 51 55 50 C40 45 20 44 6 48 C3 49 1 45 3 41 Z" fill="#ffffff" />
          <circle cx="47" cy="6" r="6" fill="#ffffff" />
        </svg>
      ) : null}
    </span>
  );
}
