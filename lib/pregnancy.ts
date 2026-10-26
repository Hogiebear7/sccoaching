// General-public educational guidance only, not medical advice — every
// stage's content carries the same disclaimer, and the consult-your-provider
// framing is repeated deliberately rather than trusted to a single mention,
// since this content touches pregnancy safety. Mirrors cycle-phase.ts's
// shape (phase estimate + guidance strings) so the two "reproductive health"
// features read as one consistent pattern.
//
// The advice follows Irish guidance (HSE, FSAI) — sources in
// docs/pregnancy-support-sources-2026-10.md. The owner is having it checked
// by a specialist, so all of the wording lives in this one file.

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
  "General information only, not medical advice. Always follow your own GP, obstetrician, midwife or public health nurse — especially if you have any complications, are high-risk, or have been told to change or avoid exercise.";

// Food safety list shared by every trimester (HSE / FSAI guidance).
const PREGNANCY_AVOID: string[] = [
  "Alcohol — there's no known safe amount in pregnancy",
  "Unpasteurised milk, and cheese made from it; soft mould-ripened cheeses (brie, camembert) and soft blue cheeses unless cooked until steaming hot",
  "Pâté of any kind, and liver or liver products (too much vitamin A)",
  "Raw or undercooked meat, poultry and eggs; cook eggs until the white and yolk are firm, or use pasteurised eggs",
  "Shark, swordfish and marlin; limit tuna to one fresh steak or two medium tins a week, and oily fish to two portions a week",
  "Cold-smoked or cured fish (such as smoked salmon) unless cooked until steaming hot",
  "Vitamin A supplements and fish liver oils such as cod liver oil",
  "More than 200 mg of caffeine a day — roughly two mugs of instant coffee; tea, cola and energy drinks count too",
  "Herbal remedies and supplements unless your GP or pharmacist says they're safe",
];

const TRIMESTER_CONTENT: Record<Trimester, TrimesterContent> = {
  1: {
    label: "First trimester",
    summary:
      "Weeks 1–13. You don't need extra calories yet — the focus is on the right supplements and safe food. For most low-risk pregnancies it's fine to keep training much as before, adjusted to how you feel. Tiredness and nausea are common, and a lighter week is completely normal.",
    trainingDo: [
      "Continue your normal training if you feel well and your doctor or midwife hasn't advised otherwise",
      "Stay well hydrated and avoid overheating, especially in hot rooms or hot weather",
      "Ease off or rest on days with strong nausea or tiredness — this is expected, not a setback",
    ],
    trainingAvoid: [
      "Contact sports and anything with a real risk of falls or knocks to the bump",
      "Scuba diving, and exercising at altitude you're not used to",
      "Starting brand-new, very hard training you haven't done before",
    ],
    nutritionDo: [
      "Take 400 µg of folic acid every day until the end of week 12 — some women need a higher dose, so check with your GP",
      "Take 10 µg of vitamin D every day throughout pregnancy",
      "Choose a pregnancy multivitamin that contains iodine (usually 100–200 µg) — iodine is hard to get from food alone",
      "Eat protein at every meal: lean meat, fish, eggs (well cooked), beans, lentils or dairy",
      "Iron-rich foods (red meat, beans, lentils, fortified cereals, green leafy vegetables), with some vitamin C such as fruit to help absorb it",
      "Three servings a day of milk, yoghurt or cheese (or calcium-fortified alternatives)",
      "If nausea makes big meals hard, small regular meals and snacks often help — plain starchy foods are usually easiest",
    ],
    nutritionAvoid: PREGNANCY_AVOID,
    recoveryDo: [
      "Prioritise sleep — tiredness is often strongest in this trimester",
      "It's normal to need more recovery time between sessions than before",
    ],
  },
  2: {
    label: "Second trimester",
    summary:
      "Weeks 14–27. You need about 250 extra calories a day now — roughly a slice of wholegrain toast with peanut butter and a glass of milk. Often the most comfortable time to train as early symptoms ease, though your changing shape matters more for exercise choice.",
    trainingDo: [
      "Continue strength training with sensible changes as your bump grows",
      "Favour standing, seated or side-lying versions over long periods flat on your back",
      "Keep prioritising hydration and avoiding overheating",
    ],
    trainingAvoid: [
      "Long periods lying flat on your back (from about 16–20 weeks) — it can reduce blood flow for some people",
      "Exercises with a real risk of falls or knocks to the bump",
      "Deep, end-range stretching — pregnancy hormones loosen joints, so it's easier to overstretch without feeling it",
    ],
    nutritionDo: [
      "About 250 extra calories a day (your target already includes this)",
      "Keep taking 10 µg of vitamin D every day, and a multivitamin with iodine",
      "Oily fish once or twice a week (salmon, mackerel, sardines, trout) for omega-3 — no more than two portions",
      "Keep up iron-rich foods and three servings of dairy a day",
      "Plenty of fibre and fluids — wholegrains, fruit, vegetables and water help with constipation",
    ],
    nutritionAvoid: PREGNANCY_AVOID,
    recoveryDo: [
      "A pulling ache low in the belly or hip (round ligament pain) is common — ease off if it flares; it usually isn't serious",
      "Your balance point is shifting, so balance-heavy movements may need extra care",
    ],
  },
  3: {
    label: "Third trimester",
    summary:
      "Weeks 28–40+. You need up to 500 extra calories a day now. Comfort and balance shape what training looks like — lower impact, better supported, and guided by how you feel each day.",
    trainingDo: [
      "Favour lower-impact, well-supported movement — walking, swimming, stationary cycling, guided strength work",
      "Pelvic floor and posture work can help as your shape changes further",
      "Stop and contact your doctor or midwife straight away for pain, dizziness, bleeding, contractions, fluid leaking, or your baby moving less",
    ],
    trainingAvoid: [
      "Lying flat on your back for any length of time",
      "Anything with a real risk of falls — balance is genuinely different late in pregnancy",
      "Pushing through pain, unusual breathlessness, or exercising to exhaustion",
    ],
    nutritionDo: [
      "Up to 500 extra calories a day (your target already includes this)",
      "Keep taking 10 µg of vitamin D every day, and a multivitamin with iodine",
      "Smaller, more frequent meals can help with heartburn and feeling full",
      "Iron-rich foods matter most now — tell your midwife if you feel unusually tired or breathless",
      "Oily fish once or twice a week, three servings of dairy, and plenty of fluids",
    ],
    nutritionAvoid: PREGNANCY_AVOID,
    recoveryDo: [
      "Sleeping on your side is recommended from 28 weeks",
      "Swelling and broken sleep are common — gentle movement and putting your feet up can help",
    ],
  },
  postpartum: {
    label: "After the birth",
    summary:
      "The first 12 weeks after your baby's birth. Your target is set to maintain your weight — this isn't the time for a deficit. Return to training is individual: be guided by your recovery and your doctor or midwife, not a fixed timeline.",
    trainingDo: [
      "Walking and gentle pelvic floor exercises are usually fine in the first weeks",
      "Get the all-clear at your 6-week check before structured training — especially after a caesarean or a complicated birth",
      "Rebuild gradually: pelvic floor and deep core strength often need attention before your old intensity",
    ],
    trainingAvoid: [
      "Running, jumping and heavy lifting before about 12 weeks, and before you've been checked",
      "Pushing through heaviness, leaking, pain or a bulge in your tummy — see a women's health physiotherapist",
    ],
    nutritionDo: [
      "Keep taking 10 µg of vitamin D every day, and folic acid if your GP advised it",
      "Regular meals and snacks — broken sleep makes it easy to skip them",
      "Protein, iron-rich foods and plenty of fluids to support your recovery, especially if you lost a lot of blood (ask your GP about iron)",
      "Fibre and water help with constipation after the birth",
    ],
    nutritionAvoid: ["Crash dieting or cutting calories hard — your body is recovering"],
    recoveryDo: ["Sleep is often broken now — be patient with your training capacity while that settles"],
  },
};

// Used instead of the after-birth advice while the member is breastfeeding,
// in the first 12 weeks and for as long as breastfeeding continues.
const BREASTFEEDING_CONTENT: TrimesterContent = {
  label: "Breastfeeding",
  summary:
    "Your target includes about 500 extra calories a day while you're breastfeeding. Let the app know when you stop. You don't need a special diet, but a few things matter.",
  trainingDo: TRIMESTER_CONTENT.postpartum.trainingDo,
  trainingAvoid: TRIMESTER_CONTENT.postpartum.trainingAvoid,
  nutritionDo: [
    "About 500 extra calories a day (your target already includes this)",
    "Keep taking 10 µg of vitamin D every day",
    "Iodine needs stay higher while breastfeeding — dairy, fish and eggs help; ask your pharmacist about a supplement with iodine",
    "Drink to thirst — a glass of water at each feed is an easy habit",
    "Oily fish once or twice a week, no more than two portions",
  ],
  nutritionAvoid: [
    "Alcohol — it's best avoided; if you do drink, talk to your public health nurse about timing feeds",
    "More than about 200 mg of caffeine a day — it passes into breast milk",
    "Shark, swordfish and marlin",
    "Cutting calories hard — it can affect your milk supply and energy",
  ],
  recoveryDo: TRIMESTER_CONTENT.postpartum.recoveryDo,
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
/** Weeks after the birth that the after-birth advice covers. */
const POSTPARTUM_WEEKS = 12;

function localDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Computes an estimated due date from a "currently N weeks along" entry made on a given date. */
export function computeDueDate(weeksAtEntry: number, enteredOnDateISO: string): string {
  const entered = localDate(enteredOnDateISO);
  const conceptionAnchor = new Date(entered.getTime() - weeksAtEntry * 7 * DAY_MS);
  const due = new Date(conceptionAnchor.getTime() + FULL_TERM_DAYS * DAY_MS);
  return due.toISOString().slice(0, 10);
}

export function estimatePregnancy(
  isPregnant: boolean,
  dueDate: string | null,
  asOfDateISO?: string,
  /** Set once the baby has arrived (see the pregnancy status route). */
  afterBirth?: { birthDate?: string | null; breastfeeding?: boolean | null }
): PregnancyEstimate {
  if (!isPregnant || !dueDate) {
    return { isPregnant: false, weeksPregnant: null, trimester: null, dueDate: null, content: null, disclaimer: DISCLAIMER };
  }

  const due = localDate(dueDate);
  const conceptionAnchor = new Date(due.getTime() - FULL_TERM_DAYS * DAY_MS);

  let asOf = new Date();
  if (asOfDateISO) {
    const [ay, am, ad] = asOfDateISO.split("-").map(Number);
    if (ay && am && ad) asOf = new Date(ay, am - 1, ad);
  }
  asOf.setHours(0, 0, 0, 0);

  const birth = afterBirth?.birthDate ? localDate(afterBirth.birthDate) : due;
  const daysSinceConception = Math.floor((asOf.getTime() - conceptionAnchor.getTime()) / DAY_MS);
  const weeksPregnant = Math.max(0, Math.floor(daysSinceConception / 7));

  if (asOf.getTime() >= birth.getTime()) {
    const weeksSinceBirth = Math.floor((asOf.getTime() - birth.getTime()) / (7 * DAY_MS));
    const breastfeeding = afterBirth?.breastfeeding === true;
    // Advice runs for 12 weeks after the birth, and for as long as the
    // member is breastfeeding after that.
    const content =
      breastfeeding ? BREASTFEEDING_CONTENT : weeksSinceBirth < POSTPARTUM_WEEKS ? TRIMESTER_CONTENT.postpartum : null;
    return { isPregnant: true, weeksPregnant: null, trimester: "postpartum", dueDate, content, disclaimer: DISCLAIMER };
  }

  const trimester: Trimester = weeksPregnant < 14 ? 1 : weeksPregnant < 28 ? 2 : 3;
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
