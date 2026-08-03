import type { StrengthSection, SetLevelTier } from "@/lib/workouts";

// Aggregate "how much have I trained each muscle group" body diagram —
// distinct from MuscleMap.tsx's per-exercise single-zone indicator. Reuses
// the same geometric "athletic emblem" body-block construction, but every
// zone renders simultaneously at a graded intensity instead of one zone
// being on/off.
//
// Deliberately rendered in the --data blue family, not gold: this is an
// analytical/informational surface (weekly training volume), not a
// brand-action or premium moment — matches the token-semantics rule from
// this project's palette audit (--data for distinct informational meaning,
// gold reserved for brand-action/premium).

type Zone = "front-upper" | "front-core" | "front-legs" | "back-upper" | "back-lower";

const ZONE_BY_SECTION: Record<StrengthSection, Zone> = {
  upper_push: "front-upper",
  core: "front-core",
  lower_push: "front-legs",
  upper_pull: "back-upper",
  lower_pull: "back-lower",
};

const MUTED = "oklch(1 0 0 / 0.14)";
const MUTED_STROKE = "oklch(1 0 0 / 0.22)";

const TIER_OPACITY: Record<Exclude<SetLevelTier, "none">, number> = {
  low: 0.38,
  moderate: 0.68,
  high: 1,
};

function fillProps(zone: Zone, byZone: Partial<Record<Zone, SetLevelTier>>): { fill: string; fillOpacity: number } {
  const tier = byZone[zone] ?? "none";
  if (tier === "none") return { fill: MUTED, fillOpacity: 1 };
  // Raw var() reference — the bare "--data" custom property doesn't exist;
  // --accent-data is the underlying token ("--color-data" is only the
  // @theme alias that powers the bg-data/text-data Tailwind utilities).
  return { fill: "var(--accent-data)", fillOpacity: TIER_OPACITY[tier] };
}

function FrontBody({ byZone }: { byZone: Partial<Record<Zone, SetLevelTier>> }) {
  const upper = fillProps("front-upper", byZone);
  const core = fillProps("front-core", byZone);
  const legs = fillProps("front-legs", byZone);
  return (
    <svg viewBox="0 0 100 200" fill="none" aria-hidden="true" className="h-full w-full">
      <circle cx="50" cy="16" r="12" fill={MUTED} stroke={MUTED_STROKE} strokeWidth="1" />
      <rect x="12" y="34" width="12" height="52" rx="6" fill={upper.fill} fillOpacity={upper.fillOpacity} />
      <rect x="76" y="34" width="12" height="52" rx="6" fill={upper.fill} fillOpacity={upper.fillOpacity} />
      <rect x="26" y="30" width="48" height="36" rx="14" fill={upper.fill} fillOpacity={upper.fillOpacity} />
      <rect x="32" y="64" width="36" height="34" rx="10" fill={core.fill} fillOpacity={core.fillOpacity} />
      <rect x="30" y="96" width="40" height="18" rx="9" fill={MUTED} />
      <rect x="32" y="112" width="16" height="48" rx="7" fill={legs.fill} fillOpacity={legs.fillOpacity} />
      <rect x="52" y="112" width="16" height="48" rx="7" fill={legs.fill} fillOpacity={legs.fillOpacity} />
      <rect x="33" y="162" width="14" height="34" rx="6" fill={MUTED} />
      <rect x="53" y="162" width="14" height="34" rx="6" fill={MUTED} />
    </svg>
  );
}

function BackBody({ byZone }: { byZone: Partial<Record<Zone, SetLevelTier>> }) {
  const upper = fillProps("back-upper", byZone);
  const lower = fillProps("back-lower", byZone);
  return (
    <svg viewBox="0 0 100 200" fill="none" aria-hidden="true" className="h-full w-full">
      <circle cx="50" cy="16" r="12" fill={MUTED} stroke={MUTED_STROKE} strokeWidth="1" />
      <rect x="12" y="34" width="12" height="52" rx="6" fill={upper.fill} fillOpacity={upper.fillOpacity} />
      <rect x="76" y="34" width="12" height="52" rx="6" fill={upper.fill} fillOpacity={upper.fillOpacity} />
      <path
        d="M26 30 h48 a14 14 0 0 1 14 14 v6 a34 34 0 0 1 -76 0 v-6 a14 14 0 0 1 14 -14 z"
        fill={upper.fill}
        fillOpacity={upper.fillOpacity}
      />
      <rect x="34" y="66" width="32" height="30" rx="9" fill={MUTED} />
      <rect x="30" y="96" width="40" height="22" rx="11" fill={lower.fill} fillOpacity={lower.fillOpacity} />
      <rect x="32" y="118" width="16" height="42" rx="7" fill={lower.fill} fillOpacity={lower.fillOpacity} />
      <rect x="52" y="118" width="16" height="42" rx="7" fill={lower.fill} fillOpacity={lower.fillOpacity} />
      <rect x="33" y="160" width="14" height="36" rx="6" fill={MUTED} />
      <rect x="53" y="160" width="14" height="36" rx="6" fill={MUTED} />
    </svg>
  );
}

// Front + back pair, always shown together — the five tracked sections span
// both views (upper_pull/lower_pull only ever show on the back), so a
// front-only diagram would silently hide two-fifths of the picture.
export function MuscleSetLevelDiagram({
  levels,
  className = "",
}: {
  levels: Record<StrengthSection, { tier: SetLevelTier }>;
  className?: string;
}) {
  const byZone: Partial<Record<Zone, SetLevelTier>> = {};
  (Object.keys(levels) as StrengthSection[]).forEach((section) => {
    byZone[ZONE_BY_SECTION[section]] = levels[section].tier;
  });

  return (
    <div className={`flex items-center justify-center gap-6 ${className}`}>
      <div className="h-full w-auto max-w-[110px] flex-1">
        <FrontBody byZone={byZone} />
      </div>
      <div className="h-full w-auto max-w-[110px] flex-1">
        <BackBody byZone={byZone} />
      </div>
    </div>
  );
}
