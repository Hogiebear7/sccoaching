// Training guidance for pregnancy and the 12 weeks after the birth, and
// flags for exercises that need a swap at the member's stage. Pure, so the
// phone app can mirror it (sc-coaching-mobile/src/lib/pregnancy-training.ts).
//
// Sources (docs/pregnancy-support-sources-2026-10.md): the SOGC/CSEP 2019
// Canadian guideline (150 min a week, talk test), ACOG Committee Opinion 804
// (2020), the IOC expert group papers, the return-to-running guidance
// (Goom, Donnelly & Brockwell 2019) and the 6 Rs framework (Donnelly 2021).
// Exercise flags match on the exercise name, so they can miss or over-match;
// the coach has the final say.

import type { NutritionStage } from "./pregnancy-nutrition";

export interface TrainingGuidance {
  headline: string;
  /** Effort to aim for, as a talk test and a 1–10 scale. */
  effort: string;
  points: string[];
}

export const STOP_SIGNS =
  "Stop and contact your doctor or midwife for bleeding, fluid leaking, regular painful contractions, chest pain, dizziness, a headache, calf pain or swelling, or breathlessness before you start.";

export function trainingGuidanceFor(stage: NutritionStage): TrainingGuidance | null {
  if (stage.kind === "pregnant") {
    const late = stage.trimester === 3;
    return {
      headline: `Training in your ${["first", "second", "third"][stage.trimester - 1]} trimester`,
      effort: late
        ? "Aim for an effort of about 4–6 out of 10. You should be able to hold a conversation."
        : "Aim for an effort of about 5–7 out of 10. You should be able to hold a conversation. If you trained hard before, some harder work is fine on days you feel well.",
      points: [
        "Aim for at least 150 minutes of moderate activity a week over 3 or more days, mixing strength work and cardio.",
        "Leave 2–3 reps in the tank on every set, and avoid maximum lifts and long breath holds.",
        stage.weeksPregnant >= 16
          ? "Avoid long periods lying flat on your back: use an incline bench, or a standing or seated version."
          : "From about 16 weeks, swap exercises done lying flat on your back for incline, standing or seated versions.",
        "Avoid contact sports and anything with a real risk of falls.",
        STOP_SIGNS,
      ],
    };
  }
  const weeks = stage.weeksSinceBirth;
  if (weeks < 6) {
    return {
      headline: "The first 6 weeks after the birth",
      effort: "Keep it gentle: walking at an easy pace, about 2–4 out of 10.",
      points: [
        "Walking, breathing exercises and pelvic floor exercises are the place to start.",
        "Wait for your 6-week check before structured training, especially after a caesarean or a difficult birth.",
        "Heaviness, leaking, pain or bleeding that gets heavier means ease off and talk to your GP or midwife.",
      ],
    };
  }
  if (weeks < 12) {
    return {
      headline: "Weeks 6–12 after the birth",
      effort: "Light to moderate: about 4–6 out of 10, building week by week.",
      points: [
        "Once you've been cleared, start low-load strength work: bodyweight and light weights, good technique, full control.",
        "Keep up pelvic floor and deep core work; a women's health physiotherapist can check how they're recovering.",
        "No running, jumping or heavy lifting yet. Most women are ready to start at around 12 weeks.",
        "Heaviness, leaking, pain or a bulge down the middle of your tummy means scale back and get checked.",
      ],
    };
  }
  return null;
}

export interface ExerciseFlag {
  reason: string;
  swap: string;
}

type Rule = {
  match: RegExp;
  /** Applies when this returns true for the stage. */
  when: (stage: NutritionStage) => boolean;
  flag: ExerciseFlag;
};

const pregnantFrom = (weeks: number) => (s: NutritionStage) => s.kind === "pregnant" && s.weeksPregnant >= weeks;
const beforeWeeksAfterBirth = (weeks: number) => (s: NutritionStage) =>
  (s.kind === "postpartum" || s.kind === "breastfeeding") && s.weeksSinceBirth < weeks;
const either = (...fs: ((s: NutritionStage) => boolean)[]) => (s: NutritionStage) => fs.some((f) => f(s));

const RULES: Rule[] = [
  {
    // Lying flat on the back.
    match: /\b(bench press|floor press|flat bench|chest fly|dumbbell fly|pullover|skull ?crusher|lying tricep|glute bridge|dead ?bug|lying leg raise|supine|crunch|sit[- ]?up)\b/i,
    when: pregnantFrom(16),
    flag: {
      reason: "Done lying flat on your back, which is best avoided from about 16 weeks.",
      swap: "Use an incline bench (about 30–45°), or a standing or seated version.",
    },
  },
  {
    // Lying face down.
    match: /\b(prone|lying leg curl|superman|chest[- ]supported row)\b/i,
    when: pregnantFrom(14),
    flag: {
      reason: "Done lying face down, which gets uncomfortable and puts pressure on the bump.",
      swap: "Try a seated leg curl, a seated cable row or a single-arm row with support.",
    },
  },
  {
    // Crunching and twisting the abdominals.
    match: /\b(crunch|sit[- ]?up|v[- ]?up|toes to bar|russian twist|ab (wheel|roll ?out)|rollout|hanging leg raise|jack ?knife)\b/i,
    when: either(pregnantFrom(14), beforeWeeksAfterBirth(12)),
    flag: {
      reason: "Hard crunching and twisting load the stretched tummy muscles. Watch for a dome or ridge down the middle.",
      swap: "Side planks, bird dogs, Pallof presses or dead bugs done on an incline.",
    },
  },
  {
    // Jumping, landing and sprinting.
    match: /\b(box jump|jump|plyo|burpee|bound|skip(ping)?|sprint|hop|depth drop)\b/i,
    when: either(pregnantFrom(14), beforeWeeksAfterBirth(12)),
    flag: {
      reason: "Impact and jumping add load to the pelvic floor, and balance changes raise the risk of a fall.",
      swap: "Step-ups, a bike or rower, or a brisk incline walk.",
    },
  },
  {
    // Running after the birth.
    match: /\b(run|running|jog)\b/i,
    when: beforeWeeksAfterBirth(12),
    flag: {
      reason: "Running is usually best left until about 12 weeks after the birth, once there's no heaviness, leaking or pain.",
      swap: "Brisk walking, the bike or the cross-trainer.",
    },
  },
  {
    // Contact and fall risk at any stage of pregnancy.
    match: /\b(sparring|boxing|grappling|contact|tackl)/i,
    when: (s) => s.kind === "pregnant",
    flag: {
      reason: "Contact and knocks to the bump are best avoided in pregnancy.",
      swap: "Pad work or bag work with no contact, or another cardio option.",
    },
  },
];

export function exerciseFlagFor(exerciseName: string, stage: NutritionStage | null): ExerciseFlag | null {
  if (!stage) return null;
  if (/\b(incline|standing|seated)\b/i.test(exerciseName) && /\b(press|fly|row|curl)\b/i.test(exerciseName)) return null;
  for (const rule of RULES) {
    if (rule.when(stage) && rule.match.test(exerciseName)) return rule.flag;
  }
  return null;
}
