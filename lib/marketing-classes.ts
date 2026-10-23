// The three classes featured on the public marketing homepage. Plain data so
// it can later be served from the back end/CMS without touching layout. Names
// match the class catalogue the app shows (scripts/seed-catalog.mjs).
export interface MarketingClass {
  name: string;
  /** One line shown on the card at all times. */
  tagline: string;
  /** Shown on hover, keyboard focus, or the Details toggle. */
  description: string;
  price: { from: string; per: string };
}

export const MARKETING_CLASSES: MarketingClass[] = [
  {
    name: "Semi-Private Personal Training",
    tagline: "Strength, technique and progression, with individual attention in a small group.",
    description:
      "Built around your goals from the first session. For beginners who want to learn the basics properly, and experienced lifters working toward a specific strength or performance goal.",
    price: { from: "€160", per: "month" },
  },
  {
    name: "Parent & Baby Classes",
    tagline: "Rebuild strength after birth, with your baby beside you.",
    description:
      "A supportive session for the postnatal period: rebuild strength, improve movement and return to training safely, without needing childcare sorted first.",
    price: { from: "€20", per: "class" },
  },
  {
    name: "Over 50s",
    tagline: "Stay strong, mobile and independent for the long term.",
    description:
      "Strength, balance and mobility training for older adults who want to protect their independence: stronger joints and confidence in everyday movement.",
    price: { from: "€20", per: "class" },
  },
];
