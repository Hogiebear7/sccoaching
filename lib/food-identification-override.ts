import type { IdentifiedFoodItem } from "./ai";
import type { FoodIdentificationOverrideRecord } from "./db";

const MAX_TRIGGER_LABEL_LENGTH = 100;

// The match key for an override — trims, lowercases, and collapses internal
// whitespace so "Milk", " milk ", and "milk" (the AI won't always phrase its
// own output identically call to call) all hit the same standing correction.
export function normalizeTriggerLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ").slice(0, MAX_TRIGGER_LABEL_LENGTH);
}

export interface ReviewedFoodItem extends IdentifiedFoodItem {
  /** true when this item's fields were swapped in by a standing member
      override rather than the vision model's own read of the photo — lets
      the client show a "using your saved correction" badge instead of
      silently rewriting what was just identified. */
  overridden: boolean;
}

// Deterministic post-processing swap, applied right after identifyFoodPhoto
// returns — never a change to the vision prompt/call itself, so this adds no
// AI cost and never affects any other member's results. Text relevance is
// exact-match only (via normalizeTriggerLabel), not fuzzy, since a wrong
// silent substitution on a near-miss would be worse than just leaving the
// AI's own (editable) guess in place.
export function applyFoodIdentificationOverrides(
  items: IdentifiedFoodItem[],
  overrides: FoodIdentificationOverrideRecord[]
): ReviewedFoodItem[] {
  if (overrides.length === 0) {
    return items.map((item) => ({ ...item, overridden: false }));
  }

  const byTrigger = new Map(overrides.map((o) => [o.triggerLabel, o]));

  return items.map((item) => {
    const match = byTrigger.get(normalizeTriggerLabel(item.name));
    if (!match) return { ...item, overridden: false };

    return {
      ...item,
      name: match.preferredFood.name,
      servingDescription: match.preferredFood.servingDescription,
      calories: match.preferredFood.calories,
      proteinG: match.preferredFood.proteinG,
      carbsG: match.preferredFood.carbsG,
      fatG: match.preferredFood.fatG,
      overridden: true,
    };
  });
}
