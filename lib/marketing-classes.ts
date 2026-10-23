// The three classes featured on the public marketing homepage. Plain data so
// it can later be served from the back end/CMS without touching layout.
export interface MarketingClass {
  name: string;
  /** One line shown on the card before it is opened. */
  tagline: string;
  description: string;
  price: { from: string; per: string };
  image: { src: string; alt: string };
}

export const MARKETING_CLASSES: MarketingClass[] = [
  {
    name: "Semi-Private Personal Training",
    tagline: "Strength, technique and progression, coached individually in a small group.",
    description:
      "Small-group coaching with individual attention, built around strength, technique, and progression. Best suited to beginners who want to learn the basics properly, and experienced lifters working toward a specific strength or performance goal.",
    price: { from: "€160", per: "month" },
    image: {
      src: "/marketing/semi-private-training.jpg",
      alt: "A coach spotting an athlete during a barbell back squat in a small-group training session",
    },
  },
  {
    name: "Parent & Baby Classes",
    tagline: "Rebuild strength after birth, with your baby beside you.",
    description:
      "A supportive session for new parents to rebuild strength, improve movement, and train with their baby nearby. Ideal for anyone in the postnatal period looking to return to training safely, without needing childcare sorted first.",
    price: { from: "€20", per: "class" },
    image: {
      src: "/marketing/parent-baby-class.jpg",
      alt: "A parent training with a supported squat while their baby rests safely nearby",
    },
  },
  {
    name: "Older Athletes",
    tagline: "Stay strong, mobile and independent for the long term.",
    description:
      "Smart, resilient training for older adults who want to stay strong, mobile, and capable for the long term. Built for anyone who wants to protect their independence — better balance, stronger joints, and confidence in everyday movement.",
    price: { from: "€20", per: "class" },
    image: {
      src: "/marketing/over-50s.jpg",
      alt: "An older athlete performing a kettlebell deadlift with a coach observing her form",
    },
  },
];
