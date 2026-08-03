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
      "Small-group coaching with individual attention, built around strength, technique, and progression.",
  },
  {
    name: "Parent & Baby Classes",
    description:
      "A supportive session for new parents to rebuild strength, improve movement, and train with their baby nearby.",
  },
  {
    name: "Older Athletes",
    description:
      "Smart, resilient training for older adults who want to stay strong, mobile, and capable for the long term.",
  },
];
