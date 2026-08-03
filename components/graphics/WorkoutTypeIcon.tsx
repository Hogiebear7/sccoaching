import type { ExerciseSection } from "@/lib/db";

// Bold single-shape "athletic emblem" marks for the workout-type vocabulary
// used across Schedule (class categories) and the exercise library (section
// groupings) — the same real-world concept renders identically everywhere
// it appears, per the illustration-system brief. Deliberately not a thin
// stroke icon-font style: each mark is one confident filled shape, matching
// the muscle map's construction language.
export type WorkoutType = "strength" | "conditioning" | "mobility" | "recovery" | "yoga" | "cardio";

export const WORKOUT_TYPE_LABEL: Record<WorkoutType, string> = {
  strength: "Strength",
  conditioning: "Conditioning",
  mobility: "Mobility",
  recovery: "Recovery",
  yoga: "Yoga",
  cardio: "Cardio",
};

// Fuzzy-matches a free-text class category name (admin-defined, e.g. "HIIT
// Circuits", "Mother & Baby") to the closest workout-type glyph. Pure
// presentational mapping — does not touch the category data model. Falls
// back to "strength" (the most general/neutral mark) when nothing matches,
// so every class still gets a consistent icon rather than none at all.
export function workoutTypeFromLabel(label: string): WorkoutType {
  const s = label.toLowerCase();
  if (/(hiit|circuit|condition|boot ?camp|metcon)/.test(s)) return "conditioning";
  if (/(mobility|stretch|flex)/.test(s)) return "mobility";
  if (/(recover|rest|regen)/.test(s)) return "recovery";
  if (/(yoga|pilates)/.test(s)) return "yoga";
  if (/(cardio|run|spin|cycle|row)/.test(s)) return "cardio";
  return "strength";
}

// Same vocabulary, keyed from an exercise's ExerciseSection instead of a
// free-text label, so the library and Schedule read as one consistent
// system rather than two.
export function workoutTypeFromSection(section: ExerciseSection): WorkoutType {
  if (section === "cardio") return "cardio";
  if (section === "core") return "mobility";
  return "strength";
}

function IconShape({ type }: { type: WorkoutType }) {
  switch (type) {
    case "strength":
      // Barbell — bar with chunky plates at each end.
      return (
        <g>
          <rect x="4" y="21" width="40" height="6" rx="2" />
          <rect x="1" y="12" width="7" height="24" rx="2" />
          <rect x="40" y="12" width="7" height="24" rx="2" />
          <rect x="9" y="16" width="4" height="16" rx="1.5" />
          <rect x="35" y="16" width="4" height="16" rx="1.5" />
        </g>
      );
    case "conditioning":
      // Pulse / burst chevron — explosive effort.
      return (
        <path d="M6 26 L18 26 L22 12 L27 34 L32 20 L42 20 L42 26 L34 26 L28 44 L21 18 L16 32 L6 32 Z" />
      );
    case "mobility":
      // Flowing looped ribbon — stretch and range of motion.
      return (
        <path d="M10 34c-6-4-6-14 2-16 8-2 10 8 14 8s6-10 14-8c8 2 8 12 2 16-6 4-10-2-16-2s-10 6-16 2z" />
      );
    case "recovery":
      // Leaf — restoration, growth. Center vein cut in with the badge's own
      // background color rather than a stroke hack.
      return (
        <g>
          <path d="M24 4c14 2 20 14 16 28-10 4-22 2-28-8-4-8 0-18 12-20z" />
          <path
            d="M23 6c-1 12-1 22 6 32"
            stroke="var(--surface-1)"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />
        </g>
      );
    case "yoga":
      // Seated cross-legged figure — simplified, geometric.
      return (
        <g>
          <circle cx="24" cy="8" r="5" />
          <path d="M24 13c-5 0-8 4-8 8v3c-6 1-10 5-11 10 2 1 4 1 6 0 2 5 7 8 13 8s11-3 13-8c2 1 4 1 6 0-1-5-5-9-11-10v-3c0-4-3-8-8-8z" />
        </g>
      );
    case "cardio":
      // Heart with a pulse line cut through it.
      return (
        <path
          d="M24 40 8 25c-5-5-5-13 1-17 5-4 11-2 15 3 4-5 10-7 15-3 6 4 6 12 1 17zM10 26h7l3-6 4 10 3-7h9"
          fillRule="evenodd"
          stroke="var(--surface-1)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      );
  }
}

export function WorkoutTypeIcon({
  type,
  className = "h-4 w-4",
}: {
  type: WorkoutType;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 48 48" fill="currentColor" aria-hidden="true" className={className}>
      <IconShape type={type} />
    </svg>
  );
}
