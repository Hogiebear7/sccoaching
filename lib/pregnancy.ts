// General-public educational guidance only, not medical advice — every
// trimester's content ends with the same disclaimer, and the eligibility/
// consult-your-provider framing is repeated deliberately rather than
// trusted to a single mention, since this content touches pregnancy safety.
// Mirrors cycle-phase.ts's shape (phase estimate + guidance strings) so the
// two "reproductive health" features read as one consistent pattern rather
// than two different designs.

export type Trimester = 1 | 2 | 3 | "postpartum";

export interface TrimesterContent {
  label: string;
  summary: string;
  trainingDo: string[];
  trainingAvoid: string[];
  nutritionDo: string[];
  nutritionAvoid: string[];
  recoveryDo: string[];
}

const DISCLAIMER =
  "General educational information only, not medical advice. Always follow guidance from your own doctor, OB/GYN, or midwife — especially if you have any pregnancy complications, are high-risk, or have been told to modify or avoid exercise.";

const TRIMESTER_CONTENT: Record<Trimester, TrimesterContent> = {
  1: {
    label: "First trimester",
    summary:
      "Weeks 1–13. For most low-risk pregnancies, it's generally fine to continue your existing routine at a similar intensity, adjusted for how you feel — fatigue and nausea are common and a lighter week is completely normal.",
    trainingDo: [
      "Continue your normal training if you feel well and your provider hasn't advised otherwise",
      "Stay well hydrated and avoid overheating, especially in hot rooms or hot weather",
      "Reduce intensity or rest on days with strong nausea or fatigue — this is expected, not a setback",
    ],
    trainingAvoid: [
      "Contact sports or activities with a real fall/collision risk",
      "Scuba diving and exercising at altitude you're not acclimatised to",
      "Starting brand-new, very high-intensity training you haven't done before",
    ],
    nutritionDo: [
      "Folate/folic acid, iron, and adequate protein are especially important now",
      "Small, frequent meals can help if nausea makes larger meals hard",
    ],
    nutritionAvoid: [
      "Alcohol",
      "Unpasteurised dairy and juices",
      "Raw or undercooked meat, eggs, and fish; high-mercury fish (shark, swordfish, king mackerel)",
      "Keep caffeine modest (commonly cited guidance: under ~200mg/day, roughly one regular coffee)",
    ],
    recoveryDo: [
      "Prioritise sleep — fatigue is often most pronounced in this trimester",
      "It's normal to need more recovery time between sessions than before",
    ],
  },
  2: {
    label: "Second trimester",
    summary:
      "Weeks 14–27. Often the most comfortable window for training as early symptoms ease, though your changing shape starts to matter more for exercise choice.",
    trainingDo: [
      "Continue strength training with sensible modifications as your bump grows",
      "Favour standing, seated, or side-lying variations over long periods flat on your back",
      "Keep prioritising hydration and avoiding overheating",
    ],
    trainingAvoid: [
      "Extended time lying flat on your back (roughly from ~16–20 weeks) — it can reduce blood flow for some people",
      "Exercises with meaningful fall or abdominal-impact risk",
      "Deep, end-range stretching — pregnancy hormones increase joint laxity, so it's easier to overstretch without feeling it",
    ],
    nutritionDo: [
      "Energy needs rise — commonly cited general guidance is roughly +340 kcal/day in this trimester, adjusted to your own provider's advice",
      "Keep prioritising protein, iron, and calcium",
    ],
    nutritionAvoid: [
      "Same list as trimester one: alcohol, unpasteurised products, raw/undercooked meat, fish and eggs, high-mercury fish, modest caffeine",
    ],
    recoveryDo: [
      "Round ligament pain (a pulling ache low in the belly/hip) is common — ease off if it flares, it usually isn't serious",
      "Your centre of gravity is shifting — balance-heavy movements may need extra care",
    ],
  },
  3: {
    label: "Third trimester",
    summary:
      "Weeks 28–40+. Comfort and balance become the main drivers of what training looks like — lower-impact, more supported, and guided closely by how you feel day to day.",
    trainingDo: [
      "Favour lower-impact, well-supported movement — walking, swimming, stationary cycling, guided strength work",
      "Pelvic floor and posture-focused work can help as your shape changes further",
      "Stop and check in with your provider immediately for pain, dizziness, bleeding, contractions, reduced fetal movement, or fluid leakage during or after exercise",
    ],
    trainingAvoid: [
      "Lying flat on your back for any extended period",
      "Anything with real fall risk — balance is genuinely different late in pregnancy",
      "Pushing through pain, breathlessness beyond normal, or exercising to exhaustion",
    ],
    nutritionDo: [
      "Energy needs rise further — commonly cited general guidance is roughly +450 kcal/day in this trimester, adjusted to your own provider's advice",
      "Continue prioritising protein, iron, and calcium; DHA/omega-3s are commonly emphasised late in pregnancy",
    ],
    nutritionAvoid: [
      "Same list as earlier trimesters: alcohol, unpasteurised products, raw/undercooked meat, fish and eggs, high-mercury fish, modest caffeine",
    ],
    recoveryDo: [
      "Sleeping on your side (commonly the left side) is often more comfortable and commonly recommended later in pregnancy",
      "Swelling and disrupted sleep are common — gentle movement and elevation can help",
    ],
  },
  postpartum: {
    label: "Postpartum",
    summary:
      "Your due date has passed. Return to training is highly individual and should be guided by your own recovery and your provider's clearance, not a fixed timeline.",
    trainingDo: [
      "Get clearance from your provider before resuming structured training, especially after a C-section or a complicated delivery",
      "Rebuild gradually — pelvic floor and core function often need dedicated attention before returning to your previous intensity",
    ],
    trainingAvoid: ["Resuming high-impact or heavy loading before you've been cleared to do so"],
    nutritionDo: [
      "Energy and nutrient needs remain elevated, especially if breastfeeding — this is a good time to keep nutrition consistent, not restrict",
    ],
    nutritionAvoid: [],
    recoveryDo: ["Sleep is often fragmented now — be patient with training capacity while that settles"],
  },
};

export interface PregnancyEstimate {
  isPregnant: boolean;
  weeksPregnant: number | null;
  trimester: Trimester | null;
  dueDate: string | null;
  content: TrimesterContent | null;
  disclaimer: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FULL_TERM_DAYS = 280; // 40 weeks

/** Computes an estimated due date from a "currently N weeks along" entry made on a given date. */
export function computeDueDate(weeksAtEntry: number, enteredOnDateISO: string): string {
  const [y, m, d] = enteredOnDateISO.split("-").map(Number);
  const entered = new Date(y, m - 1, d);
  const conceptionAnchor = new Date(entered.getTime() - weeksAtEntry * 7 * DAY_MS);
  const due = new Date(conceptionAnchor.getTime() + FULL_TERM_DAYS * DAY_MS);
  return due.toISOString().slice(0, 10);
}

export function estimatePregnancy(
  isPregnant: boolean,
  dueDate: string | null,
  asOfDateISO?: string
): PregnancyEstimate {
  if (!isPregnant || !dueDate) {
    return { isPregnant: false, weeksPregnant: null, trimester: null, dueDate: null, content: null, disclaimer: DISCLAIMER };
  }

  const [dy, dm, dd] = dueDate.split("-").map(Number);
  const due = new Date(dy, dm - 1, dd);
  const conceptionAnchor = new Date(due.getTime() - FULL_TERM_DAYS * DAY_MS);

  let asOf = new Date();
  if (asOfDateISO) {
    const [ay, am, ad] = asOfDateISO.split("-").map(Number);
    if (ay && am && ad) asOf = new Date(ay, am - 1, ad);
  }
  asOf.setHours(0, 0, 0, 0);

  const daysSinceConception = Math.floor((asOf.getTime() - conceptionAnchor.getTime()) / DAY_MS);
  const weeksPregnant = Math.max(0, Math.floor(daysSinceConception / 7));

  let trimester: Trimester;
  if (daysSinceConception > FULL_TERM_DAYS) trimester = "postpartum";
  else if (weeksPregnant < 14) trimester = 1;
  else if (weeksPregnant < 28) trimester = 2;
  else trimester = 3;

  return {
    isPregnant: true,
    weeksPregnant,
    trimester,
    dueDate,
    content: TRIMESTER_CONTENT[trimester],
    disclaimer: DISCLAIMER,
  };
}

/** After this many weeks, the coach-sharing toggle unlocks — until then it stays hidden, not just off. */
export const COACH_SHARE_UNLOCK_WEEKS = 12;
