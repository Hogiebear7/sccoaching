// The "care" cards in a coach's class brief (owner-approved wording, 2026-11-16): pregnancy guidance (only when the member has chosen to share her pregnancy
// with her coach), what to do about an injury or illness she mentioned in her check-in, and a Health notes card (her sign-up notes, her medical picks, the
// coach's own note) with condition flags. Pure and deterministic. These are PROMPTS for the coach, not medical advice; keyword flags can miss or over-match,
// so the member's own words are always shown next to them and the coach decides.
import type { NutritionStage } from "./pregnancy-nutrition";

export interface CareCard {
  id: "pregnancy" | "injury" | "illness" | "health_notes" | "parq_missing";
  title: string;
  /** "caution" cards are drawn with more emphasis. */
  tone: "caution" | "note";
  lines: string[];
  footnote: string;
}

export interface CareInputs {
  /** Only pass a stage when the member has switched "share with my coach" on. Otherwise null, and the brief says nothing about pregnancy. */
  sharedStage: NutritionStage | null;
  /** Her current check-in note (see lib/health-note.ts), if any. */
  checkInNote: string | null;
  /** The "Yes" answers on the member's PAR-Q (lib/parq.ts), with the question and her own note. Empty when there are none. */
  parqYes?: { question: string; note: string }[];
  /** True when the PAR-Q gate is on and this member has no current PAR-Q. */
  parqMissing?: boolean;
  /** From her sign-up: free text ("any other info, injuries"), "diet or medical" notes, and the medical pick list. */
  signupInfo: string | null;
  signupMedicalNotes: string | null;
  medicalPicks: string[];
  /** The coach's own note on the member's profile. */
  coachNote: string | null;
}

const NOT_ADVICE = "General guidance for coaches, not medical advice.";

// ── Pregnancy ───────────────────────────────────────────────────────────────

const STOP_SIGNS_COACH =
  "If she mentions bleeding, fluid leaking, regular painful contractions, chest pain, dizziness, a bad headache, calf pain or swelling, or breathlessness before she starts, she should not train and should contact her doctor or midwife.";
const BACK_REASON =
  "Avoid exercises lying flat on her back. Use incline, standing or seated versions. (Why: from about the second trimester the weight of the baby can press on the large vein that returns blood to the heart, which can cause dizziness or faintness.)";

function pregnancyCard(stage: NutritionStage): CareCard {
  if (stage.kind === "pregnant") {
    const ordinal = ["1st", "2nd", "3rd"][stage.trimester - 1];
    const late = stage.trimester === 3;
    const lines = [
      "She has shared this with her coach.",
      late
        ? "Aim for a lower effort, about 4 to 6 out of 10. She should be able to hold a conversation."
        : stage.trimester === 1
          ? "Aim for a moderate effort, about 5 to 7 out of 10. She should be able to hold a conversation. If she trained hard before, harder work is fine on days she feels well."
          : "Aim for a moderate effort, about 5 to 7 out of 10. She should be able to hold a conversation.",
      "Leave 2 to 3 reps in the tank on every set. No maximal lifts and no long breath holds.",
      stage.weeksPregnant >= 16 ? BACK_REASON : "From about 16 weeks, swap exercises lying flat on her back for incline, standing or seated versions.",
      late ? "Lower the impact and modify more as she goes. Avoid contact work and anything with a real risk of falls or a knock to the stomach." : "Avoid contact work and anything with a real risk of falls or a knock to the stomach.",
      "Check in at the start: how is she today? Anything new since last time?",
      STOP_SIGNS_COACH,
    ];
    return { id: "pregnancy", title: `Pregnant: ${stage.weeksPregnant} weeks (${ordinal} trimester)`, tone: "note", lines, footnote: `${NOT_ADVICE} She should follow her doctor or midwife's advice.` };
  }
  const weeks = stage.weeksSinceBirth;
  return {
    id: "pregnancy",
    title: `Postnatal: ${weeks} week${weeks === 1 ? "" : "s"} since the birth`,
    tone: "note",
    lines: [
      "She has shared this with her coach.",
      "Build back gradually, pelvic floor and core first.",
      "Be cautious and mindful of running or impact. (Why: the pelvic floor, abdominal wall and joints are still recovering for months after birth, and impact can bring on leaking, heaviness or pain. Ask about those, and check she has had her postnatal check.)",
      "Ask about bleeding, pain, breastfeeding and sleep.",
    ],
    footnote: `${NOT_ADVICE} She should follow her doctor or midwife's advice.`,
  };
}

// ── Injury and illness (from the check-in note) ─────────────────────────────

const INJURY_WORDS = /\b(injur\w*|strain\w*|sprain\w*|torn|tear|pulled|pain\w*|hurt\w*|ache|aching|broken|fracture\w*|twist\w*|swollen|swelling|cramp\w*|surgery)\b/i;
const ILLNESS_WORDS = /\b(sick|ill|illness|flu|cold|covid|fever|virus|bug|nausea|nauseous|vomit\w*|dizzy|infection|concussion|migraine|headache)\b/i;

export const mentionsInjury = (text: string) => INJURY_WORDS.test(text);
export const mentionsIllness = (text: string) => ILLNESS_WORDS.test(text);

const injuryCard = (): CareCard => ({
  id: "injury",
  title: "She mentioned an injury in her check-in",
  tone: "caution",
  lines: [
    "Ask where it is and how it is today before she starts.",
    "Sharp pain, pain that is getting worse, or pain at rest: stop, don't push through it.",
    "Work around the area: swap exercises, lighter loads, no maximal efforts.",
    "If it has lasted more than a couple of weeks or limits daily life, suggest she sees a physio or her doctor.",
  ],
  footnote: "General prompts for coaches, not medical advice.",
});

const illnessCard = (): CareCard => ({
  id: "illness",
  title: "She mentioned feeling unwell in her check-in",
  tone: "caution",
  lines: [
    "Ask how she feels today.",
    "Fever, chest symptoms, vomiting or feeling properly unwell: no training today.",
    "Only mild symptoms from the neck up (a runny nose, a mild sore throat): a lighter, shorter session is her call.",
    "After illness, build back up gradually over a few sessions.",
  ],
  footnote: "General prompts for coaches, not medical advice.",
});

// ── Health notes and condition flags ────────────────────────────────────────

export interface ConditionFlag {
  code: "diabetes" | "blood_pressure" | "heart" | "asthma" | "epilepsy" | "fibromyalgia" | "osteoporosis" | "surgery" | "pregnancy";
  label: string;
  /** Only diabetes has a specific question (owner decision, 2026-11-16). */
  ask?: string;
}

const CONDITIONS: { code: ConditionFlag["code"]; label: string; match: RegExp; ask?: string }[] = [
  { code: "diabetes", label: "diabetes", match: /diabet/i, ask: "have they eaten, and do they have fast sugar with them?" },
  { code: "blood_pressure", label: "blood pressure", match: /blood pressure|hypertens|hypotens|\bBP\b/i },
  { code: "heart", label: "heart or cardiac condition", match: /\bheart\b|cardiac|cardio-?vascular|arrhythmi|angina|palpitation/i },
  { code: "asthma", label: "asthma", match: /asthma/i },
  { code: "epilepsy", label: "epilepsy", match: /epilep|seizure/i },
  { code: "fibromyalgia", label: "fibromyalgia", match: /fibromyalg/i },
  { code: "osteoporosis", label: "osteoporosis", match: /osteopor/i },
  { code: "surgery", label: "recent surgery", match: /surger|operation|post-?op\b/i },
  { code: "pregnancy", label: "pregnancy", match: /pregnan/i },
];

/** Which conditions the member's own words mention. Keyword matching only: it can miss or over-match. */
export function conditionFlags(texts: (string | null | undefined)[]): ConditionFlag[] {
  const text = texts.filter(Boolean).join(" \n ");
  if (!text) return [];
  return CONDITIONS.filter((c) => c.match.test(text)).map(({ code, label, ask }) => ({ code, label, ask }));
}

function healthNotesCard(inputs: CareInputs): CareCard | null {
  const info = inputs.signupInfo?.trim();
  const medNotes = inputs.signupMedicalNotes?.trim();
  const picks = inputs.medicalPicks.filter((p) => p.trim());
  const coach = inputs.coachNote?.trim();
  const parqYes = inputs.parqYes ?? [];
  if (!info && !medNotes && picks.length === 0 && !coach && parqYes.length === 0) return null;

  const flags = conditionFlags([info, medNotes, ...picks, coach, ...parqYes.flatMap((p) => [p.question, p.note])]);
  const lines: string[] = [];
  for (const f of flags) lines.push(f.ask ? `Flag: ${f.label}. Ask before training: ${f.ask}` : `Flag: ${f.label}.`);
  for (const p of parqYes) lines.push(`PAR-Q, yes to: "${p.question}"${p.note ? ` Their note: "${p.note}"` : ""}`);
  if (info) lines.push(`From sign-up: "${info}"`);
  if (medNotes) lines.push(`Diet or medical notes: "${medNotes}"`);
  if (picks.length) lines.push(`Medical (selected at sign-up): ${picks.join(", ")}`);
  if (coach) lines.push(`Coach note: "${coach}"`);

  return {
    id: "health_notes",
    title: "Health notes",
    tone: flags.length ? "caution" : "note",
    lines,
    footnote: "Take their own words as given, and ask if you're unsure. The flags are keyword matches and can miss things. General prompts for coaches, not medical advice.",
  };
}

/** The cards for one member, in the order a coach should read them: pregnancy, injury, illness, health notes. */
export function buildCareCards(inputs: CareInputs): CareCard[] {
  const cards: CareCard[] = [];
  if (inputs.sharedStage) cards.push(pregnancyCard(inputs.sharedStage));
  const note = inputs.checkInNote?.trim();
  if (note) {
    if (mentionsInjury(note)) cards.push(injuryCard());
    if (mentionsIllness(note)) cards.push(illnessCard());
  }
  const health = healthNotesCard(inputs);
  if (health) cards.push(health);
  if (inputs.parqMissing) {
    cards.push({
      id: "parq_missing",
      title: "No health check (PAR-Q) on file",
      tone: "note",
      lines: ["They haven't completed the PAR-Q yet. Ask about injuries, medical conditions and medication before training."],
      footnote: "General prompts for coaches, not medical advice.",
    });
  }
  return cards;
}
