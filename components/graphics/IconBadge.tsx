import type { ReactNode } from "react";

// The one consistent "plate" every workout-type and food-category icon sits
// in, everywhere they appear — Schedule, Exercise Library, Nutrition. Reuses
// the rounded-square icon-chip language already established by
// WorkoutHelper/Notifications rather than introducing a new container.
export function IconBadge({
  children,
  tone = "gold",
  size = "md",
}: {
  children: ReactNode;
  tone?: "gold" | "neutral";
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-11 w-11" : "h-9 w-9";
  const iconSizeClass = size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-5 w-5" : "h-4 w-4";
  const toneClass =
    tone === "gold"
      ? "border-gold/25 bg-gold/[0.1] text-gold"
      : "border-white/[0.09] bg-white/[0.05] text-zinc-300";
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-lg border ${sizeClass} ${toneClass}`}>
      <div className={iconSizeClass}>{children}</div>
    </div>
  );
}
