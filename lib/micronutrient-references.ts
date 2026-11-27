// The EU reference amounts for the tracked vitamins and minerals, for ADULTS (18 and over), pregnancy and breastfeeding.
//
// SOURCE: EFSA NDA Panel, "Summary of Dietary Reference Values", version 4 (September 2017), Tables 5, 7, 9 and 11 (minerals and vitamins, men and women) and Table 3 (fatty acids, water):
// https://www.efsa.europa.eu/sites/default/files/assets/DRV_Summary_tables_jan_17.pdf  The numbers below were copied from that document, not from memory. Each is a PRI (Population Reference
// Intake: enough for nearly everyone) or an AI (Adequate Intake: a good estimate where a PRI cannot be set). Neither is a limit or a target to hit exactly, and none is medical advice.
//
// Choices made here, all stated so a reviewer can change them (and a qualified person should check the pregnancy and breastfeeding figures before launch):
//  * Calcium: 950 mg is EFSA's figure from age 25; 18 to 24 years is 1,000 mg (a younger adult is shown 1,000).
//  * Iron for women: 16 mg before the menopause, 11 mg after (a member who has said she is post-menopausal). Men 11 mg. Pregnancy and breastfeeding 16 mg.
//  * Zinc: EFSA gives four figures that depend on how much phytate (found in cereals and pulses) the diet has: 300, 600, 900 or 1,200 mg a day. We show the 600 mg level, a typical mixed diet.
//  * Someone who has not said whether they are male or female (or chose "Other") sees the HIGHER of the two figures, and the note says so.
//  * Omega-3: EFSA sets two things, 250 mg a day of EPA plus DHA and an ALA amount (0.5% of energy). We track total omega-3, so no single figure is shown; the note explains.
//  * Anyone under 18 gets no reference (the figures differ by age and are not included here).
//
// Pure: no datastore access.
import type { MicroKey } from "./micronutrients";

export type ReferenceKind = "PRI" | "AI";

export interface ReferenceValue {
  amount: number;
  kind: ReferenceKind;
}

interface Row {
  male: ReferenceValue;
  /** Women who are not pregnant or breastfeeding (before the menopause where it matters). */
  female: ReferenceValue;
  /** Women after the menopause, only where it differs (iron). */
  femalePost?: ReferenceValue;
  pregnant: ReferenceValue;
  breastfeeding: ReferenceValue;
  /** Plain note shown with the figure. */
  note?: string;
}

const pri = (amount: number): ReferenceValue => ({ amount, kind: "PRI" });
const ai = (amount: number): ReferenceValue => ({ amount, kind: "AI" });

// Zinc: PRI at a phytate intake of 600 mg a day. Pregnancy and breastfeeding are "+1.6" and "+2.9" on top of the non-pregnant figure (9.3 at 600), so 10.9 and 12.2.
export const MICRO_REFERENCES: Partial<Record<MicroKey, Row>> = {
  ironMg: { male: pri(11), female: pri(16), femalePost: pri(11), pregnant: pri(16), breastfeeding: pri(16) },
  calciumMg: { male: pri(950), female: pri(950), pregnant: pri(950), breastfeeding: pri(950), note: "1,000 mg for ages 18 to 24." },
  magnesiumMg: { male: ai(350), female: ai(300), pregnant: ai(300), breastfeeding: ai(300) },
  potassiumMg: { male: ai(3500), female: ai(3500), pregnant: ai(3500), breastfeeding: ai(4000) },
  zincMg: { male: pri(11.7), female: pri(9.3), pregnant: pri(10.9), breastfeeding: pri(12.2), note: "For a typical mixed diet (EFSA gives a range depending on how much phytate your diet has)." },
  iodineUg: { male: ai(150), female: ai(150), pregnant: ai(200), breastfeeding: ai(200) },
  seleniumUg: { male: ai(70), female: ai(70), pregnant: ai(70), breastfeeding: ai(85) },
  vitaminAUg: { male: pri(750), female: pri(650), pregnant: pri(700), breastfeeding: pri(1300), note: "In retinol equivalents." },
  vitaminCMg: { male: pri(110), female: pri(95), pregnant: pri(105), breastfeeding: pri(155) },
  vitaminDUg: { male: ai(15), female: ai(15), pregnant: ai(15), breastfeeding: ai(15), note: "Assumes little sun on your skin; your body also makes vitamin D from sunlight." },
  vitaminEMg: { male: ai(13), female: ai(11), pregnant: ai(11), breastfeeding: ai(11) },
  vitaminKUg: { male: ai(70), female: ai(70), pregnant: ai(70), breastfeeding: ai(70) },
  vitaminB12Ug: { male: ai(4), female: ai(4), pregnant: ai(4.5), breastfeeding: ai(5) },
  folateUg: { male: pri(330), female: pri(330), pregnant: pri(600), breastfeeding: pri(500), note: "In dietary folate equivalents." },
};

export const REFERENCE_SOURCE = "EFSA Dietary Reference Values (summary, version 4, September 2017)";
export const OMEGA3_NOTE = "EFSA suggests 250 mg a day of EPA plus DHA (from oily fish) and a little ALA (about 0.5% of your energy). There is no single total, so no figure is shown.";

export interface ReferenceProfile {
  gender?: string | null;
  dateOfBirth?: string | null;
  isPregnant?: boolean;
  breastfeeding?: boolean;
  menopauseStage?: string | null;
}

export interface ResolvedReference {
  key: MicroKey;
  amount: number | null;
  kind: ReferenceKind | null;
  /** "EFSA adequate intake" / "EFSA population reference intake", with any plain note. */
  text: string;
}

/** Whole years on `now`, or null when the date of birth is missing or unreadable. */
export function ageInYears(dateOfBirth: string | null | undefined, now: Date): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

/** The reference for one nutrient for this person, or null when none applies (under 18, or no figure). */
export function resolveReference(key: MicroKey, profile: ReferenceProfile, now: Date = new Date()): ResolvedReference | null {
  if (key === "omega3G") return { key, amount: null, kind: null, text: OMEGA3_NOTE };
  const row = MICRO_REFERENCES[key];
  if (!row) return null;
  const age = ageInYears(profile.dateOfBirth, now);
  if (age !== null && age < 18) return null;

  let chosen: ReferenceValue;
  let higherOfBoth = false;
  if (profile.breastfeeding) chosen = row.breastfeeding;
  else if (profile.isPregnant) chosen = row.pregnant;
  else if (profile.gender === "Male") chosen = row.male;
  else if (profile.gender === "Female") chosen = profile.menopauseStage === "postmenopause" && row.femalePost ? row.femalePost : row.female;
  else {
    higherOfBoth = true;
    chosen = row.male.amount >= row.female.amount ? row.male : row.female;
  }
  if (key === "calciumMg" && age !== null && age < 25) chosen = pri(1000);

  const label = chosen.kind === "PRI" ? "EFSA population reference intake" : "EFSA adequate intake";
  const notes = [row.note, higherOfBoth ? "EFSA gives separate figures for men and women; the higher one is shown." : null].filter(Boolean).join(" ");
  return { key, amount: chosen.amount, kind: chosen.kind, text: `${label}${notes ? `. ${notes}` : "."}` };
}

/** Share of the reference reached, 0 and up (can pass 1), or null when there is no figure or nothing is known. */
export function referenceShare(total: number, reference: { amount: number | null } | null | undefined): number | null {
  if (!reference || reference.amount === null || reference.amount <= 0 || !Number.isFinite(total) || total < 0) return null;
  return total / reference.amount;
}
