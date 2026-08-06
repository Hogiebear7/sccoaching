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
      // Athletic body silhouette — head, V-taper torso, arms, legs. Reads as
      // "muscle/physique" rather than any one food source, so it stays
      // diet-neutral across meat, dairy, and plant protein alike.
      return (
        <g>
          <circle cx="24" cy="8.5" r="5.5" />
          <path d="M15 17c3-2 6-3 9-3s6 1 9 3c1 5 0 10-2 14H17c-2-4-3-9-2-14z" />
          <path d="M15 17c-4 1-7 5-7 10 0 3 1 5 3 7l3-3c-1-1-2-3-2-5 0-3 1-5 3-6z" />
          <path d="M33 17c4 1 7 5 7 10 0 3-1 5-3 7l-3-3c1-1 2-3 2-5 0-3-1-5-3-6z" />
          <path d="M18 31c-1 4-1 8 0 11h5c0-4 0-8-1-11z" />
          <path d="M30 31c1 4 1 8 0 11h-5c0-4 0-8 1-11z" />
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
