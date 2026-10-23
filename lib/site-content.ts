// Copy for the public website's inner pages (/classes, /about, /contact,
// /faq) and the shared header/footer. Same rules as lib/homepage-content.ts:
// plain data, trust from process and clear terms, and no statistics,
// qualifications, years of experience, testimonials or results claims.

export const SITE_NAV = [
  { label: "Classes", href: "/classes" },
  { label: "About", href: "/about" },
  { label: "The app", href: "/#app" },
  { label: "FAQ", href: "/faq" },
  { label: "Contact", href: "/contact" },
] as const;

export const PRIMARY_CTA = { label: "Book a session", href: "/contact" } as const;

// The member's path from enquiry to training; shared by /classes and /contact
// (the homepage's shorter version lives in HOME_CONTACT.steps).
export const START_STEPS = [
  {
    title: "Send an enquiry",
    body: "Tell us what you're training for and which class interests you. Not sure? Say so, and we'll help you choose.",
  },
  {
    title: "We reply to arrange a baseline",
    body: "A coach gets back to you by email or phone to book your first session at a time that suits.",
  },
  {
    title: "Baseline session",
    body: "We talk through your goals and history, then assess how you move. Bring training clothes, trainers and water.",
  },
  {
    title: "Your plan begins",
    body: "Your first block is written for you and waiting in the app, along with booking and coach messaging.",
  },
] as const;

export const CLASSES_PAGE = {
  title: "Three ways to train with us.",
  intro:
    "Every class is coached, capped and programmed. Pick the one that sounds like you, or ask us and we'll help you choose.",
  selectLabel: "Which sounds like you?",
  includedTitle: "Every plan includes",
  stepsTitle: "How you start.",
  faqTitle: "Before you enquire.",
  // Question text from lib/faq-content.ts to show as a short FAQ on this page.
  faqQuestions: [
    "How much does it cost?",
    "Do I need experience to start?",
    "What should I bring to my first session?",
    "What's the cancellation policy?",
  ],
} as const;

export const ABOUT_PAGE = {
  title: "Coaching, done properly.",
  intro:
    "S&C Performance Coaching is a small strength and conditioning studio in Navan, Co. Meath. We coach people, not a room: every member trains on a plan written for them, with a coach watching every rep.",
  whoTitle: "Who we coach.",
  who: [
    {
      title: "People who want to get strong",
      body: "Beginners learning to lift properly, and experienced lifters who want a coach to plan the work.",
    },
    {
      title: "Parents after birth",
      body: "A coached, sensible return to training in the postnatal period, with your baby beside you.",
    },
    {
      title: "Adults over 50",
      body: "Strength, balance and mobility for staying capable and independent for the long term.",
    },
  ],
  philosophyTitle: "What we believe.",
  philosophy: [
    {
      title: "Strength is the foundation",
      body: "Getting stronger makes almost everything else easier: moving well, staying healthy, and doing more of what you enjoy.",
    },
    {
      title: "Coaching beats guesswork",
      body: "Technique is taught and watched, not left to a video. Small groups make that possible on every set.",
    },
    {
      title: "Progress should be planned",
      body: "Training follows a plan that builds over weeks, and the plan changes when your body, schedule or goals do.",
    },
    {
      title: "Recovery is part of training",
      body: "Sleep, soreness and stress shape what a session should look like. We ask, and we adjust.",
    },
  ],
  structureTitle: "How coaching is structured.",
  structureIntro:
    "Training runs in blocks. Each one has a purpose, and each one is built from what the last one showed us.",
  structure: [
    { title: "Baseline", body: "Your first session sets your goals and measures where you start." },
    { title: "Block", body: "Your coach writes the next few weeks of training around that starting point." },
    { title: "Coached sessions", body: "You train in a small group, with cues specific to you." },
    { title: "Review and adjust", body: "What you log in the app shapes the next block." },
  ],
  structureNote: "Then the next block begins, built from the last.",
  differentTitle: "Not a typical gym.",
  different: [
    {
      gym: "Join and work it out yourself",
      us: "A baseline session and a plan from day one",
    },
    {
      gym: "Classes sized to fill the room",
      us: "Small groups, so every rep is coached",
    },
    {
      gym: "The same workout for everyone",
      us: "Programming written for you, inside a group",
    },
    {
      gym: "Progress you have to guess at",
      us: "Training, readiness and nutrition tracked in the app",
    },
  ],
  placeBody: "A strength floor with racks, plates and kettlebells, set up for coached small-group training.",
  ctaTitle: "Start with a baseline session.",
  ctaBody: "Tell us what you're training for, and we'll take it from there.",
} as const;

export const CONTACT_PAGE = {
  title: "Book your first session.",
  intro:
    "Send a few lines about your goals and when you can train. A coach will reply to arrange your baseline session.",
  formTitle: "Send an enquiry",
  formNote: "Only your name, email and a message are needed.",
  stepsTitle: "What happens next.",
  directTitle: "Prefer to talk?",
  directBody: "Email or call the floor directly.",
} as const;

export const FAQ_PAGE = {
  title: "Questions, answered.",
  intro: "Pricing, booking, what to expect at your first session, and how the app fits in.",
  ctaTitle: "Still have a question?",
  ctaBody: "Ask us directly. We'd rather you start with the right class than guess.",
} as const;
