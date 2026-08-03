import type { ExerciseSection } from "@/lib/db";

// Stylized (not medical) front/back body silhouette that highlights which
// zone an exercise trains, driven directly by the exercise's existing
// ExerciseSection tag — no schema change, no new data. Built from simple
// geometric blocks rather than anatomical curves: a deliberate "athletic
// emblem" construction (bold, poster-like, iconic) rather than a clinical
// diagram, matching the rest of the illustration system.
//
// Zone mapping (every ExerciseSection maps to exactly one primary zone):
//   upper_push → front, chest/shoulders/arms
//   core       → front, abs
//   lower_push → front, quads
//   upper_pull → back, upper back/lats/arms
//   lower_pull → back, glutes/hamstrings
//   cardio     → front silhouette, pulse overlay (no single muscle zone —
//                cardio work doesn't isolate one, so it gets its own motif)

type Zone = "front-upper" | "front-core" | "front-legs" | "back-upper" | "back-lower" | "cardio";

const ZONE_BY_SECTION: Record<ExerciseSection, Zone> = {
  upper_push: "front-upper",
  core: "front-core",
  lower_push: "front-legs",
  upper_pull: "back-upper",
  lower_pull: "back-lower",
  cardio: "cardio",
};

// Primary/secondary muscle text, supplementing the plain "Upper — Push"
// style section label with what that actually means in the body. Text,
// not a new graphic — the refinement the graphic needs is clarity, not
// more icons.
export const MUSCLE_GROUP_LABEL: Record<ExerciseSection, { primary: string; secondary: string }> = {
  upper_push: { primary: "Chest, shoulders", secondary: "Triceps" },
  upper_pull: { primary: "Back, lats", secondary: "Biceps, rear shoulders" },
  lower_push: { primary: "Quads", secondary: "Glutes" },
  lower_pull: { primary: "Hamstrings, glutes", secondary: "Lower back" },
  core: { primary: "Abs, obliques", secondary: "Hip flexors" },
  cardio: { primary: "Heart, lungs", secondary: "Full body" },
};

const VIEW_BY_SECTION: Record<ExerciseSection, "front" | "back"> = {
  upper_push: "front",
  core: "front",
  lower_push: "front",
  upper_pull: "back",
  lower_pull: "back",
  cardio: "front",
};

const MUTED = "oklch(1 0 0 / 0.14)";
const MUTED_STROKE = "oklch(1 0 0 / 0.22)";

function Fill({ active }: { active: boolean }) {
  return active ? "var(--gold)" : MUTED;
}

// Front silhouette built from stacked rounded blocks — head, shoulder/chest
// bar, arms, core, hips, quads, shins. Highlightable zones: upper (chest +
// shoulders + arms), core (abs), legs (quads).
function FrontBody({ zone }: { zone: Zone | null }) {
  const upperOn = zone === "front-upper" || zone === "cardio";
  const coreOn = zone === "front-core";
  const legsOn = zone === "front-legs";
  return (
    <svg viewBox="0 0 100 200" fill="none" aria-hidden="true" className="h-full w-full">
      {/* head */}
      <circle cx="50" cy="16" r="12" fill={MUTED} stroke={MUTED_STROKE} strokeWidth="1" />
      {/* arms */}
      <rect x="12" y="34" width="12" height="52" rx="6" fill={Fill({ active: upperOn })} />
      <rect x="76" y="34" width="12" height="52" rx="6" fill={Fill({ active: upperOn })} />
      {/* shoulders/chest */}
      <rect x="26" y="30" width="48" height="36" rx="14" fill={Fill({ active: upperOn })} />
      {/* core */}
      <rect x="32" y="64" width="36" height="34" rx="10" fill={Fill({ active: coreOn })} />
      {/* hips (neutral) */}
      <rect x="30" y="96" width="40" height="18" rx="9" fill={MUTED} />
      {/* quads */}
      <rect x="32" y="112" width="16" height="48" rx="7" fill={Fill({ active: legsOn })} />
      <rect x="52" y="112" width="16" height="48" rx="7" fill={Fill({ active: legsOn })} />
      {/* shins (neutral) */}
      <rect x="33" y="162" width="14" height="34" rx="6" fill={MUTED} />
      <rect x="53" y="162" width="14" height="34" rx="6" fill={MUTED} />

      {zone === "cardio" && (
        <g>
          <path
            d="M50 40 L58 40 L62 30 L68 54 L74 40 L84 40"
            stroke="var(--gold)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </g>
      )}
    </svg>
  );
}

// Back silhouette — head, upper back/lats + arms, lower back, glutes +
// hamstrings, calves. Highlightable zones: upper (lats/traps/arms), lower
// (glutes + hamstrings).
function BackBody({ zone }: { zone: Zone | null }) {
  const upperOn = zone === "back-upper";
  const lowerOn = zone === "back-lower";
  return (
    <svg viewBox="0 0 100 200" fill="none" aria-hidden="true" className="h-full w-full">
      <circle cx="50" cy="16" r="12" fill={MUTED} stroke={MUTED_STROKE} strokeWidth="1" />
      <rect x="12" y="34" width="12" height="52" rx="6" fill={Fill({ active: upperOn })} />
      <rect x="76" y="34" width="12" height="52" rx="6" fill={Fill({ active: upperOn })} />
      {/* upper back / lats */}
      <path
        d="M26 30 h48 a14 14 0 0 1 14 14 v6 a34 34 0 0 1 -76 0 v-6 a14 14 0 0 1 14 -14 z"
        fill={Fill({ active: upperOn })}
      />
      {/* lower back (neutral) */}
      <rect x="34" y="66" width="32" height="30" rx="9" fill={MUTED} />
      {/* glutes */}
      <rect x="30" y="96" width="40" height="22" rx="11" fill={Fill({ active: lowerOn })} />
      {/* hamstrings */}
      <rect x="32" y="118" width="16" height="42" rx="7" fill={Fill({ active: lowerOn })} />
      <rect x="52" y="118" width="16" height="42" rx="7" fill={Fill({ active: lowerOn })} />
      {/* calves (neutral) */}
      <rect x="33" y="160" width="14" height="36" rx="6" fill={MUTED} />
      <rect x="53" y="160" width="14" height="36" rx="6" fill={MUTED} />
    </svg>
  );
}

// Compact single-view icon — picks whichever silhouette (front/back) best
// shows the exercise's zone. Used inline in list rows.
export function MuscleMap({ section, className = "h-10 w-10" }: { section: ExerciseSection; className?: string }) {
  const zone = ZONE_BY_SECTION[section];
  const view = VIEW_BY_SECTION[section];
  // The icon is decorative reinforcement, not the label itself — the real
  // text (SECTION_LABELS, or the muscle names below) always sits alongside
  // it, so a title tooltip is a bonus, not the only channel for meaning.
  return (
    <div className={className} title={MUSCLE_GROUP_LABEL[section].primary}>
      {view === "front" ? <FrontBody zone={zone} /> : <BackBody zone={zone} />}
    </div>
  );
}

// Full front + back pair, for the expanded/detail moment — the "signature"
// placement. Always shows both silhouettes so the member can see the whole
// body at a glance, with only the trained zone(s) lit.
export function MuscleMapDual({ section, className = "" }: { section: ExerciseSection; className?: string }) {
  const zone = ZONE_BY_SECTION[section];
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="h-20 w-12 shrink-0">
        <FrontBody zone={zone} />
      </div>
      <div className="h-20 w-12 shrink-0">
        <BackBody zone={zone} />
      </div>
    </div>
  );
}
