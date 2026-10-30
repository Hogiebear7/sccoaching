// FAQ copy for the homepage FAQ and the /faq page. Grounded in the app's
// actual rules (cancellation cutoff, waitlist cap, pause durations) rather
// than invented policy, so nothing here contradicts what members experience
// once they sign up.

export interface FaqItem {
  question: string;
  answer: string;
}

export interface FaqGroup {
  /** Anchor on /faq. */
  id: string;
  title: string;
  items: FaqItem[];
}

const GETTING_STARTED: FaqItem[] = [
  {
    question: "Do I need experience to start?",
    answer:
      "No. Every class is built around your own starting point. Your first session sets a baseline and shapes the block that follows, whether it's your first time lifting or you're returning to training with years behind you.",
  },
  {
    question: "Which class is right for me?",
    answer:
      "Semi-Private Personal Training suits anyone wanting individual coaching in a small group, from beginners to experienced lifters chasing a specific goal. Parent & Baby Classes are for the postnatal period, training with your baby nearby. Over 50s is built for older adults focused on strength, balance and staying capable long-term. Not sure? Get in touch and we'll point you the right way.",
  },
  {
    question: "What happens after I enquire?",
    answer:
      "A coach replies by email or phone within one working day to arrange your baseline session. In that session we talk through your goals and assess how you move, then your first block of training is written for you and set up in the app.",
  },
  {
    question: "What should I bring to my first session?",
    answer:
      "Comfortable training clothes, trainers you can lift in, a towel and water. Everything else (equipment, programme, coaching) is taken care of on the floor.",
  },
];

const CLASSES_AND_PRICING: FaqItem[] = [
  {
    question: "How much does it cost?",
    answer:
      "Semi-Private Personal Training starts from €160/month. Parent & Baby and Over 50s classes start from €15/class. Every plan includes coach messaging, class booking and full workout tracking in the app.",
  },
  {
    question: "Where are you located?",
    answer: "Navan, Co. Meath. Get in touch and we'll share everything you need for your first visit.",
  },
];

const BOOKING_AND_MEMBERSHIP: FaqItem[] = [
  {
    question: "How do I book classes?",
    answer: "Through the member app, once your membership is set up. You can see upcoming classes, book a spot and manage your bookings there.",
  },
  {
    question: "What happens if a class is full?",
    answer:
      "You can join the waitlist (up to 2 members deep per class). If a spot opens, it's offered to the first person in line with a short window to accept before it passes to the next. You'll get a notification either way.",
  },
  {
    question: "What's the cancellation policy?",
    answer:
      "Cancel at least 3 hours before a class starts and your session credit is returned automatically. Cancelling later than that forfeits the credit for that session.",
  },
  {
    question: "Can I pause my membership?",
    answer:
      "Yes. If you need a break (injury, travel, anything else), ask your coach to pause your membership for 2 weeks, 1 month or 6 months. Billing pauses with it, and everything picks back up automatically when the pause ends.",
  },
];

// App questions, kept apart from the in-person ones because the two products answer similar questions (cost, what's included) differently.
// Prices follow the paywall plan (docs/paywall-plan-2026-10.md): €12.99/month or €119.99/year, 7-day free trial.
const THE_APP: FaqItem[] = [
  {
    question: "What's included with the app?",
    answer:
      "The App Subscription adds the AI coach and AI nutrition coach, food logging from a photo or a description, daily calorie and macro targets that adapt to your training, programmes and the weekly planner, and your full history and personal bests. Logging workouts, meals and check-ins is free for everyone.",
  },
  {
    question: "How is this different from the in-person membership?",
    answer:
      "They're separate. A gym Membership (Semi-Private, Parent & Baby or Over 50s) covers your classes, booking and messaging your coach in the app. The App Subscription covers the app's digital coaching (the AI coach, targets and programmes) and is for anyone, member or not. A gym Membership doesn't include it, and it doesn't include a gym Membership.",
  },
  {
    question: "Do I need any equipment?",
    answer: "No. Tell it what you've got, from a full gym to just bodyweight, and your sessions are built around that.",
  },
  {
    question: "Is it a replacement for a real coach?",
    answer:
      "It runs on the same coaching approach used on the gym floor, not a generic template. Every session and nutrition target is built around your own data and adjusts as your training and progress change.",
  },
  {
    question: "When can I download it, and what does it cost?",
    answer:
      "The app is free to download and use for logging, launching soon on the App Store and Google Play. The App Subscription is €12.99 a month or €119.99 a year, with a 7-day free trial, bought in the app through your App Store or Google Play account. Cancel any time in your store settings.",
  },
];

// /faq: four groups, each with its own anchor.
export const FAQ_GROUPS: FaqGroup[] = [
  { id: "getting-started", title: "Getting started", items: GETTING_STARTED },
  { id: "classes-and-pricing", title: "Classes and pricing", items: CLASSES_AND_PRICING },
  { id: "booking-and-membership", title: "Booking and membership", items: BOOKING_AND_MEMBERSHIP },
  { id: "the-app", title: "The app", items: THE_APP },
];

// Homepage: the same answers in two groups.
export const HOME_FAQ_GROUPS: FaqGroup[] = [
  {
    id: "faq-training",
    title: "Training with us",
    items: [...GETTING_STARTED, ...CLASSES_AND_PRICING, ...BOOKING_AND_MEMBERSHIP.slice(1)],
  },
  { id: "faq-app", title: "The app", items: THE_APP },
];

export const ALL_FAQS: FaqItem[] = FAQ_GROUPS.flatMap((g) => g.items);
