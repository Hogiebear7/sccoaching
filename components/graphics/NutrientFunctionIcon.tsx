// A small, deliberately narrow third vocabulary — used in exactly one
// place (the Sports Performance Drink's "Ingredient benefits" list), not
// spread across the app. Most members don't intuitively know what
// beta-alanine or dietary nitrate does; these six function tags already
// exist as plain text (see INGREDIENT_BENEFITS in NutritionView) — this
// gives the same tag a small consistent mark so the list scans by
// function, not just by ingredient name. Same "athletic emblem"
// construction as the other two icon sets.
export type NutrientFunction = "Energy" | "Buffering" | "Texture" | "Nitrate" | "Flavour" | "Electrolyte";

function IconShape({ type }: { type: NutrientFunction }) {
  switch (type) {
    case "Energy":
      // Bolt — fast fuel.
      return <path d="M26 4 10 28h10l-4 16 20-26H26l4-14z" />;
    case "Buffering":
      // Wave — smoothing out acidity.
      return (
        <path
          d="M6 18c4-6 10-6 14 0s10 6 14 0"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
      );
    case "Texture":
      // Dot grid — body/mouthfeel.
      return (
        <g>
          <circle cx="14" cy="14" r="4" />
          <circle cx="24" cy="14" r="4" />
          <circle cx="34" cy="14" r="4" />
          <circle cx="14" cy="24" r="4" />
          <circle cx="24" cy="24" r="4" />
          <circle cx="34" cy="24" r="4" />
        </g>
      );
    case "Nitrate":
      // Droplet.
      return <path d="M24 4c8 10 12 17 12 23a12 12 0 01-24 0c0-6 4-13 12-23z" />;
    case "Flavour":
      // Star — palatability.
      return <path d="M24 3l5.5 13.5L44 19l-11 9.5L36 43 24 34.5 12 43l3-14.5L4 19l14.5-2.5z" />;
    case "Electrolyte":
      // Spark/pulse — mirrors the cardio pulse motif from WorkoutTypeIcon,
      // deliberately, since both mean "electrical/rate" concepts.
      return <path d="M20 4h6l-3 14h9l-14 26 3-18h-9z" />;
  }
}

export function NutrientFunctionIcon({
  type,
  className = "h-3 w-3",
}: {
  type: NutrientFunction;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 48 48" fill="currentColor" aria-hidden="true" className={className}>
      <IconShape type={type} />
    </svg>
  );
}
