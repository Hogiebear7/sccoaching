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
}

type PhaseContent = {
  label: string;
  explanation: string;
  trainingGuidance: string;
  intensityGuidance: string;
  recoveryGuidance: string;
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
  },
};

export function estimatePhase(
  lastPeriodStartDate: string | null,
  averageCycleLengthDays: number | null,
  periodLengthDays: number | null,
  regularity: CycleRegularity | null
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
    };
  }

  // Parse date without timezone shift
  const [y, m, d] = lastPeriodStartDate.split("-").map(Number);
  const lastPeriod = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const daysSince = Math.floor(
    (today.getTime() - lastPeriod.getTime()) / (1000 * 60 * 60 * 24)
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
  };
}
