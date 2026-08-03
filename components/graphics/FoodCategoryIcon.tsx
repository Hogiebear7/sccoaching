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
      // Drumstick — bold, unmistakable protein mark.
      return (
        <path d="M30 6c6 0 11 5 11 11 0 5-3 9-7 10l-8 8c2 3 2 7-1 10-3 3-8 3-11 0l-2-2-4 4c-1 1-3 1-4 0-1-1-1-3 0-4l4-4-2-2c-3-3-3-8 0-11 3-3 7-3 10-1l8-8c1-4 5-7 10-7 1-3 3-4 6-4z" />
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
