import type { FoodGroup } from "@/lib/nutrition-recommendations";

// Same "athletic emblem" construction as WorkoutTypeIcon, applied to the
// nutrition vocabulary. FoodGroup ("protein" | "carb" | "snack") is the
// real, already-populated field on every food item; "fat" is added here
// only for the macro-target tiles, which show carbs/protein/fat rather than
// the food-catalog's protein/carb/snack grouping.
export type FoodCategoryType = FoodGroup | "fat";

export const FOOD_CATEGORY_LABEL: Record<FoodCategoryType, string> = {
  protein: "Protein",
  carb: "Carbs",
  fat: "Fat",
  snack: "Snacks",
};

function IconShape({ type }: { type: FoodCategoryType }) {
  switch (type) {
    case "protein":
      // Amino-acid chain — three linked units, diet-neutral (works equally
      // for meat, dairy, or plant protein sources like tofu and lentils).
      return (
        <g>
          <path
            d="M13 35l7-7M28 20l7-7"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="10" cy="38" r="7" />
          <circle cx="24" cy="24" r="7" />
          <circle cx="38" cy="10" r="7" />
        </g>
      );
    case "carb":
      // Wheat stalk — three seed pairs up a stem.
      return (
        <g>
          <path d="M24 44V10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M24 12c-2-5-8-6-11-2 3 5 9 5 11 2zM24 12c2-5 8-6 11-2-3 5-9 5-11 2z" />
          <path d="M24 22c-2-5-8-6-11-2 3 5 9 5 11 2zM24 22c2-5 8-6 11-2-3 5-9 5-11 2z" />
          <path d="M24 32c-2-5-8-6-11-2 3 5 9 5 11 2zM24 32c2-5 8-6 11-2-3 5-9 5-11 2z" />
        </g>
      );
    case "fat":
      // Avocado half — distinctive pit circle cut in.
      return (
        <g>
          <path d="M24 4c9 0 14 9 14 20 0 12-7 20-14 20S10 36 10 24C10 13 15 4 24 4z" />
          <circle cx="24" cy="27" r="8" fill="var(--surface-1)" />
          <circle cx="24" cy="27" r="6" />
        </g>
      );
    case "snack":
      // Apple — rounded body, stem, leaf.
      return (
        <g>
          <path d="M24 14c7-4 15 0 16 9 1 10-6 21-16 21S7 33 8 23c1-9 9-13 16-9z" />
          <path d="M24 14V7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          <path d="M24 9c2-3 6-4 9-2-2 3-6 4-9 2z" />
        </g>
      );
  }
}

export function FoodCategoryIcon({
  type,
  className = "h-4 w-4",
}: {
  type: FoodCategoryType;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 48 48" fill="currentColor" aria-hidden="true" className={className}>
      <IconShape type={type} />
    </svg>
  );
}
