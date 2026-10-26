// Menopause support content: what to prioritise in training, food and
// recovery at each stage, with an evidence label on every point so members
// can see how firm each piece is. Sources and the standard used are in
// docs/menopause-support-sources-2026-10.md. Never advises on HRT or other
// treatment; that's always the GP. All of the wording lives in this one file
// so a specialist can review it.

import type { MenopauseStage } from "./profile-schema";

export type EvidenceLevel = "Strong evidence" | "Good evidence" | "Expert advice";

export interface MenopausePoint {
  text: string;
  evidence: EvidenceLevel;
}

export interface MenopauseContent {
  label: string;
  summary: string;
  training: MenopausePoint[];
  nutrition: MenopausePoint[];
  recovery: MenopausePoint[];
  disclaimer: string;
}

const DISCLAIMER =
  "General information only, not medical advice. For symptoms, treatment options including HRT, or bone density concerns, talk to your GP.";

const TRAINING: MenopausePoint[] = [
  {
    text: "Strength train 2–3 times a week, working all the major muscle groups and building up over time to heavy weights you can lift about 8–12 times. It's the most effective way to keep muscle and bone.",
    evidence: "Strong evidence",
  },
  {
    text: "Add some impact, such as skipping, hopping or small jumps, building up gradually, to help keep bones strong. Skip it if you have pelvic floor symptoms until you've been checked.",
    evidence: "Strong evidence",
  },
  {
    text: "If you've been told your bone density is low, heavy lifting and impact work can still help. Do it with a coach or physio guiding the progression.",
    evidence: "Good evidence",
  },
  {
    text: "Practise balance a few times a week (single-leg work, step-ups, slower lowering) to lower the risk of falls.",
    evidence: "Strong evidence",
  },
  {
    text: "Aim for at least 150 minutes of moderate activity a week alongside your strength work.",
    evidence: "Strong evidence",
  },
  {
    text: "Exercise hasn't been shown to reduce hot flushes, but it helps with sleep, mood, weight and heart health. If hot flushes are troubling you, your GP can talk through treatments that do help.",
    evidence: "Good evidence",
  },
];

const NUTRITION: MenopausePoint[] = [
  {
    text: "Eat protein at every meal. Your target already includes plenty for keeping muscle (1.6 g or more per kg of bodyweight).",
    evidence: "Strong evidence",
  },
  {
    text: "Have three portions of calcium-rich food a day, such as milk, yoghurt or cheese (or calcium-fortified alternatives). If you have less than one a day, ask your GP or pharmacist about a calcium supplement.",
    evidence: "Expert advice",
  },
  {
    text: "Vitamin D helps you use calcium. From 65, a 15 µg supplement every day is advised in Ireland; under 65, ask your GP or pharmacist, as many adults here run low.",
    evidence: "Expert advice",
  },
  {
    text: "Weight often creeps up in midlife, mostly from age and lifestyle rather than the menopause itself. Your calorie target follows your own burn and logs, so there's no need for a special diet.",
    evidence: "Good evidence",
  },
];

const RECOVERY: MenopausePoint[] = [
  {
    text: "Sleep can be disrupted. A regular bedtime, a cool bedroom and less alcohol and caffeine late in the day help many people.",
    evidence: "Expert advice",
  },
  {
    text: "On days after a bad night, keep the session but ease the load, rather than skipping it.",
    evidence: "Expert advice",
  },
];

const CONTENT: Record<MenopauseStage, MenopauseContent> = {
  perimenopause: {
    label: "Perimenopause",
    summary:
      "Your periods are still coming but changing, so phase estimates are less reliable and shown as rough. Strength training and good food habits now pay off for years.",
    training: TRAINING,
    nutrition: NUTRITION,
    recovery: RECOVERY,
    disclaimer: DISCLAIMER,
  },
  postmenopause: {
    label: "Post-menopause",
    summary:
      "It's been 12 months or more since your last period, so cycle phase tracking is switched off. Keeping muscle and bone strong is the priority.",
    training: TRAINING,
    nutrition: NUTRITION,
    recovery: RECOVERY,
    disclaimer: DISCLAIMER,
  },
};

export function menopauseContentFor(stage: MenopauseStage | null | undefined): MenopauseContent | null {
  return stage ? CONTENT[stage] : null;
}

export function isMenopauseStage(value: unknown): value is MenopauseStage {
  return value === "perimenopause" || value === "postmenopause";
}
