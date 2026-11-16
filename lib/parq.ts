// The PAR-Q (health check before a gym member's first session). Owner decisions 2026-11-16: gym members only (never asked at sign-up, never for the
// free or App Subscription tier), asked before the first class booking like the emergency contact, valid for 12 months, a "Yes" never blocks booking (it
// flags the coach), answers stored on the member's profile and shown to coaches in the brief's Health notes card. This is a screening record, not medical
// clearance. Wording is our own, based on the usual PAR-Q themes; confirm with the insurer.

export const PARQ_VERSION = 1;
export const PARQ_VALID_DAYS = 365;
export const PARQ_NOTE_MAX = 300;

export interface ParqQuestion {
  id: string;
  text: string;
}

export const PARQ_QUESTIONS: ParqQuestion[] = [
  { id: "heart", text: "Has a doctor ever said you have a heart condition, or that you should only do physical activity recommended by a doctor?" },
  { id: "chest", text: "Do you get chest pain when you are active, or have you had chest pain at rest in the last month?" },
  { id: "dizzy", text: "Do you lose your balance because of dizziness, or have you ever lost consciousness?" },
  { id: "bp", text: "Do you have high or low blood pressure, or take medication for blood pressure?" },
  { id: "conditions", text: "Do you have diabetes, asthma or another breathing condition, epilepsy, or osteoporosis?" },
  { id: "joints", text: "Do you have a bone, joint, muscle or back problem, or an injury, that exercise could make worse? (Include recent surgery.)" },
  { id: "pregnancy", text: "Are you pregnant, or have you given birth in the last 12 months?" },
  { id: "medication", text: "Are you taking any prescription medication, or have you been told by a doctor to avoid any kind of exercise?" },
  { id: "other", text: "Is there any other reason you should not do physical activity, or anything else your coach should know?" },
];

export const PARQ_INTRO =
  "This helps your coach keep you safe. It takes about two minutes. Answer honestly. It's not a medical test and it doesn't stop you training. If you say yes to anything, your coach will have a chat with you first.";
export const PARQ_CONSENT =
  "I agree that S&C Performance Coaching can store these answers so my coach can plan safe training for me. I understand they are health information, only my coaches and the gym owner can see them, and I can withdraw this at any time by contacting info@sandccoaching.com.";
export const PARQ_DECLARATION = "I confirm that my answers are true to the best of my knowledge, and I'll tell my coach if my health changes.";
export const PARQ_FOOTER = "This is not medical advice. If you are unsure, speak to your doctor before you start.";

export interface ParqAnswer {
  yes: boolean;
  note: string;
}

export interface ParqRecord {
  version: number;
  answeredAt: string;
  answers: Record<string, ParqAnswer>;
  consentHealthData: true;
  declaredTrue: true;
  /** For a member under 18: the parent or guardian who completed it with them. */
  guardianName?: string | null;
}

/** The PAR-Q gate is OFF until PARQ_REQUIRED=true is set, so the server can ship before the app screen does. */
export function parqRequired(): boolean {
  return process.env.PARQ_REQUIRED === "true";
}

export function parqIsCurrent(parq: ParqRecord | null | undefined, now: Date = new Date()): boolean {
  if (!parq || parq.version !== PARQ_VERSION) return false;
  const answered = Date.parse(parq.answeredAt);
  if (!Number.isFinite(answered)) return false;
  return now.getTime() - answered <= PARQ_VALID_DAYS * 86_400_000;
}

export type ParqValidation = { ok: true; record: ParqRecord } | { ok: false; message: string };

/** Checks a submission: every question answered Yes/No, consent and declaration ticked, notes trimmed and capped. */
export function validateParqSubmission(input: unknown, now: Date = new Date()): ParqValidation {
  const body = (input ?? {}) as Record<string, unknown>;
  const raw = (body.answers ?? {}) as Record<string, unknown>;
  const answers: Record<string, ParqAnswer> = {};
  for (const q of PARQ_QUESTIONS) {
    const a = raw[q.id] as { yes?: unknown; note?: unknown } | undefined;
    if (!a || typeof a.yes !== "boolean") return { ok: false, message: "Please answer every question with Yes or No." };
    const note = typeof a.note === "string" ? a.note.trim().slice(0, PARQ_NOTE_MAX) : "";
    answers[q.id] = { yes: a.yes, note };
  }
  if (body.consent !== true) return { ok: false, message: "Please tick the box to agree to us storing your answers." };
  if (body.declaration !== true) return { ok: false, message: "Please confirm your answers are true to the best of your knowledge." };
  const guardian = typeof body.guardianName === "string" ? body.guardianName.trim().slice(0, 120) : "";
  return {
    ok: true,
    record: { version: PARQ_VERSION, answeredAt: now.toISOString(), answers, consentHealthData: true, declaredTrue: true, guardianName: guardian || null },
  };
}

/** The "Yes" answers with their question text and note, for the coach brief. */
export function parqYesItems(parq: ParqRecord | null | undefined): { question: string; note: string }[] {
  if (!parq) return [];
  return PARQ_QUESTIONS.filter((q) => parq.answers[q.id]?.yes).map((q) => ({ question: q.text, note: parq.answers[q.id].note }));
}
