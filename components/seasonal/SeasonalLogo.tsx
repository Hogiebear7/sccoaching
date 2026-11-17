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
  // The owner's Canva artwork for the witch hat and bunny ears (the Santa hat above is still drawn here, to sit exactly on the website logo).
  if (season === "halloween") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img aria-hidden="true" alt="" src="/seasonal/witch-hat.png" className={`${cls} -left-[6%] -top-[34%] h-[62%] w-auto -rotate-[10deg]`} />;
  }
  if (season === "easter") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img aria-hidden="true" alt="" src="/seasonal/bunny-ears.png" className={`${cls} left-[2%] -top-[44%] h-[56%] w-auto`} />;
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
