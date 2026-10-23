// Copy for the public homepage, kept as plain data (separate from layout) so
// it can later be edited from the back end/CMS. Claims marked CONFIRM are
// carried over from the existing site and still need the coach's sign-off;
// nothing here is an invented statistic or testimonial.

export const HOME_NAV = [
  { label: "Classes", href: "#classes" },
  { label: "Approach", href: "#approach" },
  { label: "Progress", href: "#progress" },
  { label: "The app", href: "#app" },
  { label: "FAQ", href: "#faq" },
] as const;

export const HOME_HERO = {
  // Gold second half, as on the rest of the site.
  headline: { lead: "Coached,", accent: "not crowded." },
  intro:
    "Small-group strength and conditioning in Navan, Co. Meath. Programmed around your goals, coached rep by rep, and tracked in our app.",
  primaryCta: { label: "Book your first session", href: "#contact" },
  secondaryCta: { label: "See classes and pricing", href: "#classes" },
  image: {
    src: "/marketing/training-floor.jpg",
    alt: "The S&C training floor in Navan: racks, plates and kettlebells",
    caption: "The S&C training floor, Navan",
  },
} as const;

// Short authority markers for the strip under the hero. CONFIRM all four.
export const HOME_PROOF = [
  { value: "15+", label: "Years of hands-on coaching experience" },
  { value: "Capped", label: "Group sizes, so every rep is watched" },
  { value: "1:1", label: "Programming built for you, inside a group" },
  { value: "1 app", label: "Training, nutrition and recovery, tracked together" },
] as const;

export const HOME_APPROACH = {
  title: "This is a coaching floor, not a workout class.",
  intro:
    "Every member starts with a baseline session that sets your goals and starting point. From there, your coach writes the block that follows and adjusts it as you progress.",
  pillars: [
    {
      title: "Your goals, not a template",
      body: "No member starts on a generic plan. Your first session sets your goals and baseline, then shapes the block that follows.",
    },
    {
      title: "Capped coaching ratios",
      body: "Small-group sessions stay small on purpose. Every rep gets watched, every cue is specific to you, not shouted at the room.",
    },
    {
      // CONFIRM qualifications wording.
      title: "Highly qualified coach",
      body: "15+ years of hands-on experience, backed by multiple science and coaching degrees. Not your standard club trainer.",
    },
    {
      title: "Rooted in the community",
      body: "Members, athletes, and everyone in between train side by side in a calm, focused environment.",
    },
  ],
} as const;

export interface Testimonial {
  quote: string;
  name: string;
  /** e.g. "Semi-Private member since 2024". */
  context: string;
}

export const HOME_PROGRESS = {
  title: "Progress you can see.",
  intro:
    "Your training doesn't disappear when you leave the floor. Every session, check-in and meal is logged against your plan, so you and your coach can see what's working.",
  points: [
    { title: "A baseline on day one", body: "Your first session measures where you start, so every change after it is visible." },
    { title: "Readiness before you train", body: "A short daily check-in on sleep, soreness and fatigue shapes the session ahead." },
    { title: "Lifts and targets, tracked", body: "Weekly volume, personal bests and nutrition targets update as you progress." },
  ],
  // Real member quotes only. The testimonials block stays hidden while this is empty.
  testimonials: [] as Testimonial[],
} as const;

export const HOME_CONTACT = {
  title: "Book your first session.",
  intro:
    "Tell us what you're training for. We'll book your baseline session and you'll leave with a plan and a coach who already knows your goals.",
  steps: [
    { title: "Send an enquiry", body: "A few lines about your goals and availability." },
    { title: "Baseline session", body: "We assess where you're starting from, on the floor." },
    { title: "Your plan begins", body: "Your first block is written and waiting in the app." },
  ],
  primaryCta: "Email to book",
  secondaryCta: "Call the floor",
} as const;
