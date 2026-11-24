// Fixed red-flag check for the AI coach chat (owner plan 2026-11-24, "safer version" of injury guidance). It does NOT depend on the AI model: a member's message
// is checked here first, and when it describes something that can be serious the member gets a fixed, reviewed reply that points them to urgent care, with no model
// call. The AI itself is never asked to judge how serious something is.
//
// Deliberately cautious: it leans towards sending someone to get checked. A false alarm costs one reply ("tell me more and I'll help"); a miss could cost much more.
// It is a safety net, not a diagnosis, and it never says what the problem is.
//
// Wording is Irish (112 or 999, emergency department, GP). The exact text is in the owner's review pack, injury-guidance-legal-review-2026-11-24.md (in the App Design Overhaul folder) for review before release.

export type TriageLevel = "emergency" | "urgent" | "pregnancy";

export interface TriageResult {
  level: TriageLevel;
  /** Short internal labels for what matched (for tests and logs). Never shown to the member and never includes the message text. */
  flags: string[];
  /** The fixed reply to send instead of calling the model. */
  reply: string;
}

interface Rule {
  flag: string;
  level: TriageLevel;
  pattern: RegExp;
}

const RULES: Rule[] = [
  // Emergency: call 112 or 999.
  { flag: "chest_pain", level: "emergency", pattern: /\bchest\s+(pain|tightness|pressure)\b|\b(pain|pressure|tightness)\s+(in|across|on)\s+(my\s+|the\s+)?chest\b/ },
  { flag: "breathing", level: "emergency", pattern: /\bcan'?t\s+(breathe|catch\s+my\s+breath)\b|\bstruggling\s+to\s+breathe\b|\bshort(ness)?\s+of\s+breath\b/ },
  { flag: "collapse", level: "emergency", pattern: /\b(faint(ed|ing)|passed\s+out|blacked\s+out|collapsed|lost\s+consciousness|unconscious)\b/ },
  {
    flag: "head_injury_symptoms",
    level: "emergency",
    pattern: /\b(head\s+(injury|knock|blow)|hit\s+my\s+head|banged\s+my\s+head|knocked\s+my\s+head|concuss(ed|ion))\b.{0,120}\b(confus\w*|vomit\w*|sick|drows\w*|dizzy|memory|blurr\w*|double\s+vision|worsening|getting\s+worse)\b/,
  },
  { flag: "stroke_signs", level: "emergency", pattern: /\bface\s+(is\s+)?droop\w*|\bslurred\s+speech\b|\bsudden(ly)?\s+(numb|weak)\w*\b/ },
  { flag: "open_or_deformed", level: "emergency", pattern: /\bbone\s+(is\s+)?(sticking|poking)\b|\b(deformed|deformity|bent\s+the\s+wrong\s+way)\b|\b(visibly|obviously)\s+(broken|dislocated)\b/ },
  { flag: "heavy_bleeding", level: "emergency", pattern: /\bbleeding\s+(heavily|a\s+lot|badly)\b|\bwon'?t\s+stop\s+bleeding\b|\bbleeding\s+won'?t\s+stop\b/ },
  {
    flag: "cauda_equina",
    level: "emergency",
    pattern: /\b(lost|loss\s+of|can'?t\s+control|no\s+control\s+of)\s+(control\s+of\s+)?(my\s+)?(bladder|bowel)\b|\b(incontinen\w+|wet\s+myself)\b|\bnumb\w*\s+(in|around)\s+(my\s+)?(groin|saddle|genital\w*|inner\s+thighs?)\b/,
  },

  // Pregnancy: contact the maternity unit or GP straight away.
  {
    flag: "pregnancy_warning",
    level: "pregnancy",
    pattern: /\bvaginal\s+bleeding\b|\bbleeding\b.{0,30}\bpregnan\w*|\bpregnan\w*.{0,30}\bbleeding\b|\bwaters?\s+(broke|breaking|have\s+broken)\b|\bfluid\s+leaking\b|\bbaby\s+(isn'?t|is\s+not|has\s+stopped|stopped)\s+moving\b|\breduced\s+(baby\s+)?movements?\b|\bsevere\s+(abdominal|stomach|tummy)\s+pain\b.{0,40}\bpregnan\w*|\bpregnan\w*.{0,40}\bsevere\s+(abdominal|stomach|tummy)\s+pain\b/,
  },

  // Urgent: get seen today.
  { flag: "cannot_bear_weight", level: "urgent", pattern: /\bcan'?t\s+(put|bear)\s+(any\s+)?weight\b|\bcan'?t\s+walk\s+on\s+(it|my\s+(leg|foot|ankle|knee))\b|\bunable\s+to\s+(walk|stand)\s+on\b/ },
  { flag: "pop_snap", level: "urgent", pattern: /\b(heard|felt)\s+(a\s+|an\s+)?(pop|snap|crack|tear|rip)\b/ },
  { flag: "locked_joint", level: "urgent", pattern: /\b(knee|joint|elbow|shoulder)\s+(is\s+|has\s+)?locked\b|\blocked\s+up\b|\bwon'?t\s+(straighten|bend)\b/ },
  { flag: "calf_swelling", level: "urgent", pattern: /\b(swollen|swelling|red|hot|warm)\W+(\w+\W+){0,4}calf\b|\bcalf\W+(\w+\W+){0,6}(swollen|swelling|red|hot|warm)\b/ },
  { flag: "numb_tingling_limb", level: "urgent", pattern: /\b(numb(ness)?|pins\s+and\s+needles|tingling)\b.{0,40}\b(leg|legs|foot|feet|arm|arms|hand|hands)\b/ },
  { flag: "fever_with_joint", level: "urgent", pattern: /\b(fever|high\s+temperature)\b.{0,40}\b(joint|swollen|swelling)\b|\b(joint|swollen|swelling)\b.{0,40}\b(fever|high\s+temperature)\b/ },
  { flag: "severe_pain", level: "urgent", pattern: /\b(severe|excruciating|unbearable|worst)\s+pain\b/ },
  { flag: "major_trauma", level: "urgent", pattern: /\b(car\s+(crash|accident)|fell\s+(off|from|down)|bad\s+fall|head\s+(injury|knock|blow)|hit\s+my\s+head|banged\s+my\s+head|concuss(ed|ion))\b/ },
];

const SIGN_OFF =
  "\n\nI'm an AI coach, not a medical service, and I can't assess this. If I've misunderstood and it isn't what you meant, tell me more and I'll help.";

const REPLIES: Record<TriageLevel, string> = {
  emergency:
    "What you've described can sometimes be serious. Please call 112 or 999 now, or go to your nearest emergency department. If someone is with you, ask them to stay with you and help." +
    "\n\nPlease don't train until you've been seen. When you're ok, the Workout Generator in Train can build a session that works around any sore area you tick." +
    SIGN_OFF,
  urgent:
    "What you've described is worth getting checked soon. Please get seen today: go to an urgent care or injury unit or an emergency department, or phone your GP and tell them it's new or getting worse. If it gets worse, or you feel unwell, call 112 or 999." +
    "\n\nPlease don't train the affected area until you've been seen. After that, the Workout Generator in Train can build sessions that work around any sore area you tick." +
    SIGN_OFF,
  pregnancy:
    "What you've described in pregnancy needs checking straight away. Please contact your maternity unit or GP now. If you're bleeding heavily, in severe pain, or feel very unwell, call 112 or 999 or go to your nearest emergency department." +
    "\n\nPlease don't train until you've been seen." +
    SIGN_OFF,
};

const ORDER: TriageLevel[] = ["emergency", "pregnancy", "urgent"];

/**
 * Checks one member message for red flags. Returns the most serious level that matched and the fixed reply, or null when nothing matched (the message
 * then goes to the AI as usual, under the injury rules in its instructions).
 */
export function triageInjuryMessage(text: string): TriageResult | null {
  const t = text.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
  const hits = RULES.filter((r) => r.pattern.test(t));
  if (hits.length === 0) return null;
  const level = ORDER.find((l) => hits.some((h) => h.level === l)) as TriageLevel;
  return { level, flags: hits.map((h) => h.flag), reply: REPLIES[level] };
}

/** The reply text for a level, for tests and the review document. */
export function triageReplyFor(level: TriageLevel): string {
  return REPLIES[level];
}

/**
 * What the AI coach may say about pain and injury (owner decision 2026-11-24: scaled right back): NOTHING in the way of advice. It does not say whether it is safe
 * to train, what something might be, how to treat it, how long it takes, or which exercises to do. It points to a physio or GP and to the Workout Generator, where
 * the member's own "anything sore?" choice shapes the session. Serious symptoms never reach the model: injury-triage.ts replies first. The wording is in the owner's
 * review pack, injury-guidance-legal-review-2026-11-24.md (in the App Design Overhaul folder).
 */
export const INJURY_GUIDANCE_RULE = `Pain, injury and health problems (follow strictly): you give no advice about these at all.
- If a member mentions pain, soreness, an injury or a health problem, or asks whether they can or should train, do not say whether it is safe, what it might be, how to treat it, how long it will take, or which exercises to do or avoid for it. Say in one or two plain sentences that you can't advise on injuries, and that a physio or GP is the right person to ask.
- The only practical thing you may offer is the Workout Generator in Train: they can tick the sore area under "anything sore?" and it builds a session that leaves out exercises that load that area. Do not describe the session as safe or suitable for the injury.
- If they describe anything that could be serious (chest pain, trouble breathing, fainting, a head injury, numbness, unable to put weight on a limb, a joint that locks, a hot swollen calf, severe pain, anything in pregnancy such as bleeding), tell them to seek urgent medical help (112 or 999, an emergency department, or their GP the same day) and not to train until they have been seen.`;
