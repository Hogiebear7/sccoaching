// The three classes featured on the public website (homepage cards and the
// /classes page). Plain data so it can later be served from the back end/CMS
// without touching layout. Names match the class catalogue the app shows
// (scripts/seed-catalog.mjs). Only facts the business already states are used:
// no session lengths, group sizes or schedules until the owner confirms them.
export interface MarketingClass {
  /** URL fragment on /classes and the `class` value the contact form preselects. */
  slug: string;
  name: string;
  /** One line shown on the card at all times. */
  tagline: string;
  /** Shown on hover, keyboard focus, or the Details toggle. */
  description: string;
  price: { from: string; per: string };
  /** /classes page: who the class suits, as short self-select statements. */
  forWho: string[];
  /** /classes page: what a member gets. */
  includes: string[];
  /** /classes page: what sets it apart, one or two sentences. */
  different: string;
  /** Offer-specific call to action on /classes. */
  cta: string;
}

export const MARKETING_CLASSES: MarketingClass[] = [
  {
    slug: "semi-private",
    name: "Semi-Private Personal Training",
    tagline: "Strength, technique and progression, with individual attention in a small group.",
    description:
      "Built around your goals from the first session. For beginners who want to learn the basics properly, and experienced lifters working toward a specific strength or performance goal.",
    price: { from: "€160", per: "month" },
    forWho: [
      "You're new to lifting and want to learn it properly",
      "You train already and want a coach to set the plan",
      "You're working toward a specific strength or performance goal",
    ],
    includes: [
      "A baseline session to set your goals and starting point",
      "Programming written for you and adjusted as you progress",
      "Coaching on every set, in a small group",
      "The member app: booking, coach messaging and tracking",
    ],
    different:
      "The cost of a group, the attention of personal training. You train alongside others, but your block is your own.",
    cta: "Enquire about Semi-Private",
  },
  {
    slug: "parent-and-baby",
    name: "Parent & Baby Classes",
    tagline: "Rebuild strength after birth, with your baby beside you.",
    description:
      "A supportive session for the postnatal period: rebuild strength, improve movement and return to training safely, without needing childcare sorted first.",
    price: { from: "€20", per: "class" },
    forWho: [
      "You're in the postnatal period and ready to return to training",
      "You want to rebuild strength at a sensible pace",
      "You'd rather not arrange childcare to get a session in",
    ],
    includes: [
      "Strength and movement work suited to the postnatal period",
      "Coaching that adjusts to how you're feeling on the day",
      "Your baby beside you for the session",
      "Class booking and coach messaging in the app",
    ],
    different:
      "A coached return to training rather than a general fitness class: the session is planned around rebuilding strength safely.",
    cta: "Enquire about Parent & Baby",
  },
  {
    slug: "over-50s",
    name: "Over 50s",
    tagline: "Stay strong, mobile and independent for the long term.",
    description:
      "Strength, balance and mobility training for older adults who want to protect their independence: stronger joints and confidence in everyday movement.",
    price: { from: "€20", per: "class" },
    forWho: [
      "You're over 50 and want to stay strong and capable",
      "You'd like better balance and confidence on your feet",
      "You're returning to exercise and want it coached",
    ],
    includes: [
      "Strength, balance and mobility work in every session",
      "Exercises adapted to your joints and starting point",
      "A coach watching your technique throughout",
      "Class booking and coach messaging in the app",
    ],
    different:
      "Real strength training, scaled to you: the aim is long-term independence, not a gentle class that never progresses.",
    cta: "Enquire about Over 50s",
  },
];

export function findMarketingClass(slug: string | undefined): MarketingClass | undefined {
  return MARKETING_CLASSES.find((c) => c.slug === slug);
}
