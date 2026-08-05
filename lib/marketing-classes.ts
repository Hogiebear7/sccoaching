// The three classes featured on the public marketing homepage — shared
// between the "Classes we offer" showcase and the membership pricing cards
// so the name/description copy can't drift between the two sections.
export interface MarketingClass {
  name: string;
  description: string;
}

export const MARKETING_CLASSES: MarketingClass[] = [
  {
    name: "Semi-Private Personal Training",
    description:
      "Small-group coaching with individual attention, built around strength, technique, and progression. Best suited to beginners who want to learn the basics properly, and experienced lifters working toward a specific strength or performance goal.",
  },
  {
    name: "Parent & Baby Classes",
    description:
      "A supportive session for new parents to rebuild strength, improve movement, and train with their baby nearby. Ideal for anyone in the postnatal period looking to return to training safely, without needing childcare sorted first.",
  },
  {
    name: "Mature Athletes",
    description:
      "Smart, resilient training for older adults who want to stay strong, mobile, and capable for the long term. Built for anyone who wants to protect their independence — better balance, stronger joints, and confidence in everyday movement.",
  },
];
