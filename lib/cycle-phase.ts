import type { CycleRegularity } from "./profile-schema";

export type PhaseName = "Menstrual" | "Follicular" | "Ovulatory" | "Luteal" | "Unknown";

export interface PhaseEstimate {
  phase: PhaseName;
  cycleDay: number | null;
  cycleLength: number | null;
  confidence: "standard" | "low";
  phaseLabel: string;
  explanation: string;
  trainingGuidance: string;
  intensityGuidance: string;
  recoveryGuidance: string;
  /** One short sentence — for surfacing alongside the daily readiness score, distinct from the longer `explanation`. */
  readinessNote: string;
}

type PhaseContent = {
  label: string;
  explanation: string;
  trainingGuidance: string;
  intensityGuidance: string;
  recoveryGuidance: string;
  readinessNote: string;
};

const PHASE_CONTENT: Record<Exclude<PhaseName, "Unknown">, PhaseContent> = {
  Menstrual: {
    label: "Menstrual",
    explanation:
      "Hormone levels tend to be at their lowest during menstruation. Many people find that gentler movement feels more comfortable at this time — though this varies a lot between individuals.",
    trainingGuidance:
      "Gentle movement is often well tolerated — light walks, yoga, or lower-intensity sessions. Follow your body's cues rather than pushing through discomfort.",
    intensityGuidance:
      "Lower intensities tend to suit this phase. It is fine to reduce load if you feel you need to.",
    recoveryGuidance:
      "Prioritise sleep and hydration. Iron-rich foods can help support energy levels during menstruation.",
    readinessNote:
      "You're in your menstrual phase — lighter sessions are well tolerated today, and it's fine to ease off if you need to.",
  },
  Follicular: {
    label: "Follicular",
    explanation:
      "Oestrogen tends to rise after menstruation, and many people notice improved energy and motivation in this phase. It is often a good time for more demanding training — though individual experience varies.",
    trainingGuidance:
      "Strength work, higher-volume sessions, or new challenges may feel more manageable than usual in this phase.",
    intensityGuidance:
      "Higher intensities may feel more achievable, though this differs between individuals. Use how you feel as your guide.",
    recoveryGuidance:
      "Standard recovery practices apply. Protein and sleep remain the key foundations.",
    readinessNote:
      "You're in your follicular phase — energy often trends upward here, a good window for a more demanding session.",
  },
  Ovulatory: {
    label: "Ovulatory",
    explanation:
      "Around ovulation, strength and coordination can feel near their best for some people. Many find this a productive training window, though the timing varies and is estimated here.",
    trainingGuidance:
      "High-intensity or skill-based sessions may suit this phase well for many people.",
    intensityGuidance:
      "Peak output often feels accessible here. Warm up fully — some people experience slightly increased joint laxity around ovulation.",
    recoveryGuidance: "Fuel well around harder sessions to support recovery.",
    readinessNote:
      "You're in your ovulatory phase — many people feel their strongest and most coordinated around now.",
  },
  Luteal: {
    label: "Luteal",
    explanation:
      "Progesterone rises in the luteal phase. Energy and motivation can vary — many people find it easier to train earlier in this phase and more challenging as their period approaches.",
    trainingGuidance:
      "Moderate, steady-state work often suits the early luteal phase. Reducing volume and intensity as your period approaches can help.",
    intensityGuidance:
      "Perceived effort may feel higher for the same output. Match your effort to how you feel on the day rather than hitting fixed targets.",
    recoveryGuidance:
      "Extra recovery time often helps in this phase. Magnesium-rich foods may support sleep quality and muscle comfort.",
    readinessNote:
      "You're in your luteal phase — perceived effort can run higher than usual, so match intensity to how you feel today.",
  },
};

export function estimatePhase(
  lastPeriodStartDate: string | null,
  averageCycleLengthDays: number | null,
  periodLengthDays: number | null,
  regularity: CycleRegularity | null,
  /** YYYY-MM-DD to estimate the phase as of — defaults to today. Pass a past
      workout's date to see what phase the member was likely in that day,
      rather than where they are now. */
  asOfDateISO?: string
): PhaseEstimate {
  if (!lastPeriodStartDate || !averageCycleLengthDays || averageCycleLengthDays < 14) {
    return {
      phase: "Unknown",
      cycleDay: null,
      cycleLength: averageCycleLengthDays ?? null,
      confidence: "low",
      phaseLabel: "Unknown",
      explanation: "Add your cycle information below to see an estimated phase.",
      trainingGuidance: "—",
      intensityGuidance: "—",
      recoveryGuidance: "—",
      readinessNote: "—",
    };
  }

  // Parse date without timezone shift
  const [y, m, d] = lastPeriodStartDate.split("-").map(Number);
  const lastPeriod = new Date(y, m - 1, d);
  let asOf = new Date();
  if (asOfDateISO) {
    const [ay, am, ad] = asOfDateISO.split("-").map(Number);
    if (ay && am && ad) asOf = new Date(ay, am - 1, ad);
  }
  asOf.setHours(0, 0, 0, 0);

  const daysSince = Math.floor(
    (asOf.getTime() - lastPeriod.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSince < 0) {
    return {
      phase: "Unknown",
      cycleDay: null,
      cycleLength: averageCycleLengthDays,
      confidence: "low",
      phaseLabel: "Unknown",
      explanation:
        "The last period date appears to be in the future. Please check your cycle settings.",
      trainingGuidance: "—",
      intensityGuidance: "—",
      recoveryGuidance: "—",
      readinessNote: "—",
    };
  }

  const cycleDay = (daysSince % averageCycleLengthDays) + 1;
  const periodLength = periodLengthDays ?? 5;
  const midCycle = Math.round(averageCycleLengthDays / 2);

  let phase: Exclude<PhaseName, "Unknown">;
  if (cycleDay <= periodLength) {
    phase = "Menstrual";
  } else if (cycleDay < midCycle - 1) {
    phase = "Follicular";
  } else if (cycleDay <= midCycle + 1) {
    phase = "Ovulatory";
  } else {
    phase = "Luteal";
  }

  const confidence: "standard" | "low" = regularity === "Regular" ? "standard" : "low";
  const content = PHASE_CONTENT[phase];

  return {
    phase,
    cycleDay,
    cycleLength: averageCycleLengthDays,
    confidence,
    phaseLabel: content.label,
    explanation: content.explanation,
    trainingGuidance: content.trainingGuidance,
    intensityGuidance: content.intensityGuidance,
    recoveryGuidance: content.recoveryGuidance,
    readinessNote: content.readinessNote,
  };
}

export interface PhaseSegment {
  phase: Exclude<PhaseName, "Unknown">;
  label: string;
  startDay: number;
  endDay: number;
  dayCount: number;
}

// Same day-range boundaries estimatePhase() uses to classify a cycleDay —
// kept in one place so the visual chart can never drift from what the text
// guidance says. A phase is omitted if the cycle is short enough to leave it
// no days (e.g. a very short cycle can squeeze out the follicular phase).
export function phaseSegments(cycleLength: number, periodLengthDays: number | null): PhaseSegment[] {
  const periodLength = periodLengthDays ?? 5;
  const midCycle = Math.round(cycleLength / 2);

  const raw: { phase: Exclude<PhaseName, "Unknown">; start: number; end: number }[] = [
    { phase: "Menstrual", start: 1, end: periodLength },
    { phase: "Follicular", start: periodLength + 1, end: midCycle - 2 },
    { phase: "Ovulatory", start: midCycle - 1, end: midCycle + 1 },
    { phase: "Luteal", start: midCycle + 2, end: cycleLength },
  ];

  return raw
    .map(({ phase, start, end }) => ({
      phase,
      label: PHASE_CONTENT[phase].label,
      startDay: Math.max(1, start),
      endDay: Math.min(cycleLength, end),
    }))
    .filter((seg) => seg.endDay >= seg.startDay)
    .map((seg) => ({ ...seg, dayCount: seg.endDay - seg.startDay + 1 }));
}
