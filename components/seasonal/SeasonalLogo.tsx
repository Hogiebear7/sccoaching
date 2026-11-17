"use client";

import { useSeason } from "./useSeason";

// The site logo, with a small seasonal accessory on it: a Santa hat at Christmas, a witch hat at Halloween, bunny ears at Easter, a heart, a shamrock, a leaf, or
// a sun. Plain logo outside the seasons. Positions are percentages of the logo, so it works at any size.
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
  if (season === "valentines") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={`${cls} -left-[3%] -top-[22%] h-[48%] w-auto -rotate-[16deg]`}>
        <path d="M12 21 C4 14 2 9 2 6.5 C2 3.5 4.5 2 7 2 C9 2 11 3.3 12 5 C13 3.3 15 2 17 2 C19.5 2 22 3.5 22 6.5 C22 9 20 14 12 21 Z" fill="#ff2e63" />
      </svg>
    );
  }
  if (season === "stpatricks") {
    return (
      <svg aria-hidden="true" viewBox="0 0 34 24" className={`${cls} -left-[4%] -top-[28%] h-[52%] w-auto`}>
        <g fill="#1fa84f">
          <circle cx="12" cy="7" r="5" />
          <circle cx="7" cy="13" r="5" />
          <circle cx="17" cy="13" r="5" />
        </g>
        <path d="M12 12 L13.4 22" stroke="#1fa84f" strokeWidth="2" strokeLinecap="round" />
        <circle cx="27" cy="16" r="5" fill="#f1c40f" stroke="#c99a06" strokeWidth="1.2" />
      </svg>
    );
  }
  if (season === "autumn") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={`${cls} -left-[2%] -top-[24%] h-[50%] w-auto -rotate-[20deg]`}>
        <path d="M12 2 C20 6 21 15 12 22 C3 15 4 6 12 2 Z" fill="#e07a1f" />
        <path d="M12 4 L12 21" stroke="#ffffff" strokeWidth="1" opacity="0.45" />
      </svg>
    );
  }
  if (season === "summer") {
    return (
      <svg aria-hidden="true" viewBox="-12 -12 24 24" className={`${cls} -right-[4%] -top-[30%] h-[56%] w-auto`}>
        <circle r="5" fill="#ffd23f" />
        {Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * Math.PI * 2;
          return <line key={i} x1={Math.cos(a) * 7} y1={Math.sin(a) * 7} x2={Math.cos(a) * 10.5} y2={Math.sin(a) * 10.5} stroke="#ffd23f" strokeWidth="2" strokeLinecap="round" />;
        })}
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
