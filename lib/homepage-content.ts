// Copy for the public homepage, kept as plain data (separate from layout) so
// it can later be edited from the back end/CMS. Trust here comes from how the
// coaching works (process, programming, what's included), not from proof we
// don't have yet: no statistics, qualifications, testimonials or results are
// stated. Facts about booking, pausing and cancelling mirror the FAQ and the
// app's real rules.

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

// Short markers for the strip under the hero: how the coaching works.
export const HOME_PROOF = [
  { value: "Baseline", label: "Your first session measures where you start" },
  { value: "Capped", label: "Small groups, so every rep is coached" },
  { value: "1:1", label: "Programming written for you, inside a group" },
  { value: "1 app", label: "Booking, coach messaging and tracking included" },
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
      title: "A plan that adapts",
      body: "Your block is adjusted as your lifts, readiness and recovery change, using what you log in the app rather than guesswork.",
    },
    {
      title: "Calm, focused sessions",
      body: "Members, athletes and everyone in between train side by side, without the noise of a crowded gym.",
    },
  ],
} as const;

export const HOME_PROGRESS = {
  title: "Progress you can see.",
  intro:
    "Your training doesn't disappear when you leave the floor. Every session, check-in and meal is logged against your plan, so you and your coach can see what's working.",
  points: [
    { title: "A baseline on day one", body: "Your first session measures where you start, so every change after it is visible." },
    { title: "Readiness before you train", body: "A short daily check-in on sleep, soreness and fatigue shapes the session ahead." },
    { title: "Lifts and targets, tracked", body: "Weekly volume, personal bests and nutrition targets update as you progress." },
  ],
} as const;

// "Every plan includes": concrete terms that build trust without testimonials.
export const HOME_INCLUDED = [
  { title: "Coach messaging", body: "Ask your coach a question between sessions, in the app." },
  { title: "Class booking", body: "Book in the app. If a class is full, join the waitlist." },
  { title: "Flexible cancelling", body: "Cancel at least 3 hours before a class and your credit comes back." },
  { title: "Pause when you need to", body: "Pause for 2 weeks, 1 month or 6 months; billing pauses with it." },
] as const;

export const HOME_CONTACT = {
  title: "Book your first session.",
  intro:
    "Tell us what you're training for. We'll book your baseline session and you'll leave with a plan and a coach who already knows your goals.",
  steps: [
    { title: "Send an enquiry", body: "A few lines about your goals. We reply within one working day." },
    { title: "Baseline session", body: "We assess where you're starting from. Bring training clothes, trainers, a towel and water." },
    { title: "Your plan begins", body: "Your first block is written and waiting in the app." },
  ],
  primaryCta: "Email to book",
  secondaryCta: "Call the floor",
} as const;
