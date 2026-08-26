"use client";

import { useState } from "react";

import type { StrengthSection, SetLevelTier } from "@/lib/workouts";
import { bodyFront } from "@/lib/body-highlighter-data/body-front";
import { bodyBack } from "@/lib/body-highlighter-data/body-back";
import { BODY_OUTLINE_BACK_D, BODY_OUTLINE_FRONT_D } from "@/lib/body-highlighter-data/body-outline";
import type { BodyHighlighterPart } from "@/lib/body-highlighter-data/body-front";

// Real anatomical figure (vendored react-native-body-highlighter path data —
// see lib/body-highlighter-data/) instead of the earlier hand-drawn
// geometric-block pair, so this reads as the same illustration as the
// mobile app's Set Levels screen rather than a different, simpler stand-in.
// Every real slug maps onto one of the five tracked StrengthSections so the
// whole figure can be graded by training-volume tier.
type Slug = string;

const SECTION_FOR_SLUG: Partial<Record<Slug, StrengthSection>> = {
  // Upper push — chest/shoulder/triceps-dominant pressing
  chest: "upper_push",
  deltoids: "upper_push",
  triceps: "upper_push",
  // Upper pull — back/biceps-dominant pulling
  trapezius: "upper_pull",
  "upper-back": "upper_pull",
  "lower-back": "upper_pull",
  biceps: "upper_pull",
  forearm: "upper_pull",
  // Lower push — quad/calf-dominant, anterior chain
  quadriceps: "lower_push",
  calves: "lower_push",
  // Lower pull — hamstring/glute-dominant, posterior chain / hip hinge
  hamstring: "lower_pull",
  gluteal: "lower_pull",
  adductors: "lower_pull",
  // Core
  abs: "core",
  obliques: "core",
  // tibialis, neck, and the decorative parts (hair/head/hands/feet/ankles/
  // knees) are left unmapped — always rendered at the muted default fill.
};

const TIER_OPACITY: Record<Exclude<SetLevelTier, "none">, number> = {
  low: 0.38,
  moderate: 0.68,
  high: 1,
};

const MUTED_FILL = "oklch(1 0 0 / 0.14)";
const OUTLINE_STROKE = "oklch(1 0 0 / 0.22)";

function fillFor(slug: Slug, levels: Record<StrengthSection, { tier: SetLevelTier }>): { fill: string; fillOpacity: number } {
  const section = SECTION_FOR_SLUG[slug];
  const tier = section ? levels[section].tier : "none";
  if (tier === "none") return { fill: MUTED_FILL, fillOpacity: 1 };
  return { fill: "var(--accent-data)", fillOpacity: TIER_OPACITY[tier] };
}

function BodyFigure({
  view,
  levels,
}: {
  view: "front" | "back";
  levels: Record<StrengthSection, { tier: SetLevelTier }>;
}) {
  const parts: BodyHighlighterPart[] = view === "front" ? bodyFront : bodyBack;
  const viewBox = view === "front" ? "0 0 724 1448" : "724 0 724 1448";
  const outlineD = view === "front" ? BODY_OUTLINE_FRONT_D : BODY_OUTLINE_BACK_D;

  return (
    <svg viewBox={viewBox} className="h-full w-full" aria-hidden="true">
      <path d={outlineD} stroke={OUTLINE_STROKE} strokeWidth={2} fill="none" vectorEffect="non-scaling-stroke" />
      {parts.map((part) => {
        const { fill, fillOpacity } = fillFor(part.slug, levels);
        const paths = [...(part.path.common ?? []), ...(part.path.left ?? []), ...(part.path.right ?? [])];
        return paths.map((d, i) => (
          <path key={`${part.slug}-${i}`} d={d} fill={fill} fillOpacity={fillOpacity} />
        ));
      })}
    </svg>
  );
}

// Front/back toggle, one view at a time — matches the mobile app's Set
// Levels screen rather than showing both silhouettes side by side.
export function MuscleSetLevelDiagram({
  levels,
  className = "",
}: {
  levels: Record<StrengthSection, { tier: SetLevelTier }>;
  className?: string;
}) {
  const [view, setView] = useState<"front" | "back">("front");

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div
        className="flex items-center gap-1 rounded-lg border border-white/[0.1] bg-white/[0.03] p-0.5"
        role="tablist"
        aria-label="Body view"
      >
        {(["front", "back"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`rounded-md px-3 py-1 text-[11px] font-medium capitalize transition ${
              view === v ? "bg-data/15 text-data" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="mt-3 flex min-h-0 w-full flex-1 items-center justify-center">
        <div className="h-full max-w-[200px] aspect-[724/1448]">
          <BodyFigure view={view} levels={levels} />
        </div>
      </div>
    </div>
  );
}
