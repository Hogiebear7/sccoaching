"use client";

import { useSeason } from "./useSeason";

// The site logo, with a small seasonal accessory on it: a Santa hat at Christmas, a witch hat at Halloween, and bunny ears at Easter. Plain logo otherwise
// (Valentine's and St Patrick's have no logo accessory, owner 2026-11-17). Positions are percentages of the logo, so it works at any size.
function Accessory({ season }: { season: string }) {
  const cls = "pointer-events-none absolute drop-shadow-sm";
  if (season === "christmas") {
    return (
      <svg aria-hidden="true" viewBox="0 0 64 52" className={`${cls} -left-[6%] -top-[28%] h-[58%] w-auto -rotate-[14deg]`}>
        <path d="M6 40 C8 18 24 4 46 6 C40 12 38 20 44 30 C48 36 52 40 56 42 Z" fill="#d6262c" />
        <path d="M6 40 C8 18 24 4 46 6 C42 9 38 14 36 20 C26 22 14 30 6 40 Z" fill="#ee4a4a" opacity="0.55" />
        <path d="M3 41 C20 37 42 38 60 45 C61 49 58 51 55 50 C40 45 20 44 6 48 C3 49 1 45 3 41 Z" fill="#ffffff" />
        <circle cx="47" cy="6" r="6" fill="#ffffff" />
      </svg>
    );
  }
  if (season === "halloween") {
    return (
      <svg aria-hidden="true" viewBox="0 0 64 52" className={`${cls} -left-[6%] -top-[28%] h-[58%] w-auto -rotate-[14deg]`}>
        <path d="M8 42 C14 30 22 14 40 4 C38 16 42 28 56 42 Z" fill="#1c1b22" />
        <path d="M10 36 C26 32 42 32 54 38 L56 42 L8 42 Z" fill="#7b3fb0" />
        <rect x="28" y="33" width="10" height="9" rx="1.5" fill="none" stroke="#f1c40f" strokeWidth="2" />
        <ellipse cx="32" cy="45" rx="30" ry="5" fill="#1c1b22" />
      </svg>
    );
  }
  if (season === "easter") {
    return (
      <svg aria-hidden="true" viewBox="0 0 64 56" className={`${cls} left-[4%] -top-[48%] h-[64%] w-auto`}>
        <ellipse cx="22" cy="26" rx="8" ry="22" fill="#ffffff" transform="rotate(-12 22 26)" />
        <ellipse cx="22" cy="28" rx="3.8" ry="16" fill="#ffb3c7" transform="rotate(-12 22 28)" />
        <ellipse cx="44" cy="26" rx="8" ry="22" fill="#ffffff" transform="rotate(14 44 26)" />
        <ellipse cx="44" cy="28" rx="3.8" ry="16" fill="#ffb3c7" transform="rotate(14 44 28)" />
      </svg>
    );
  }
  return null;
}

export function SeasonalLogo({ src = "/brand/website-logo-v2.png", width = 160, height = 74, className }: { src?: string; width?: number; height?: number; className?: string }) {
  const { season } = useSeason();
  return (
    <span className="relative inline-block leading-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" width={width} height={height} className={className} />
      {season ? <Accessory season={season.key} /> : null}
    </span>
  );
}
