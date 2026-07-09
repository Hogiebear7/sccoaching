import { describe, expect, it } from "vitest";

import type { WorkoutSessionRecord } from "@/lib/db";
import {
  buildWorkoutPlan,
  classifyLoad,
  decideTier,
  type HelperContext,
  type WorkoutPlan,
} from "@/lib/workout-helper";

function makeSession(
  date: string,
  exercises: { name: string; weight: string | null; reps: number | null; sets: number | null }[]
): WorkoutSessionRecord {
  return {
    id: `session-${date}`,
    userId: "user-1",
    date,
    title: "Test session",
    durationMins: 60,
    notes: null,
    exercises: exercises.map((ex) => ({
      exerciseId: null,
      name: ex.name,
      weight: ex.weight,
      reps: ex.reps,
      sets: ex.sets,
      notes: null,
    })),
    runs: [],
    createdAt: `${date}T10:00:00.000Z`,
    updatedAt: `${date}T10:00:00.000Z`,
  };
}

function ctx(overrides: Partial<HelperContext> = {}): HelperContext {
  return { readinessScore: 70, sevenDayLoad: 800, daysWithLoad: 3, ...overrides };
}

function allItems(plan: WorkoutPlan) {
  return plan.blocks.flatMap((b) => b.items);
}

describe("classifyLoad", () => {
  it("returns none with no logged days", () => {
    expect(classifyLoad(0, 0)).toBe("none");
  });

  it("bands light, moderate, and high loads", () => {
    expect(classifyLoad(500, 2)).toBe("light");
    expect(classifyLoad(1500, 4)).toBe("moderate");
    expect(classifyLoad(2600, 5)).toBe("high");
  });
});

describe("decideTier", () => {
  it("gives a full session for high readiness and manageable load", () => {
    expect(decideTier(ctx({ readinessScore: 82, sevenDayLoad: 900 })).tier).toBe("full");
  });

  it("reduces the session when readiness is low", () => {
    const result = decideTier(ctx({ readinessScore: 42 }));
    expect(result.tier).toBe("reduced");
    expect(result.rationale).toContain("42");
  });

  it("reduces the session when 7-day load is high even with good readiness", () => {
    expect(decideTier(ctx({ readinessScore: 85, sevenDayLoad: 3000, daysWithLoad: 6 })).tier).toBe(
      "reduced"
    );
  });

  it("stays standard and conservative when there is no recovery log today", () => {
    const result = decideTier(ctx({ readinessScore: null }));
    expect(result.tier).toBe("standard");
    expect(result.rationale).toMatch(/no recovery log/i);
  });
});

describe("buildWorkoutPlan — history anchoring", () => {
  const history = [
    makeSession("2026-07-01", [
      { name: "Goblet Squat", weight: "20", reps: 8, sets: 3 },
      { name: "Bench Press", weight: "60", reps: 8, sets: 3 },
    ]),
  ];

  it("anchors to the last performance and progresses slightly on a full day", () => {
    const plan = buildWorkoutPlan({
      time: 45,
      equipment: "full_gym",
      focus: "full_body",
      context: ctx({ readinessScore: 85, sevenDayLoad: 600 }),
      sessions: history,
    });

    const squat = allItems(plan).find((i) => i.name === "Goblet Squat");
    expect(squat).toBeDefined();
    expect(squat!.prescription.kind).toBe("history");
    expect(squat!.prescription.loadText).toBe("22.5 kg");
    expect(squat!.prescription.reference).toContain("3 × 8 @ 20 kg");
  });

  it("reduces the anchored load ~10% on a reduced day", () => {
    const plan = buildWorkoutPlan({
      time: 45,
      equipment: "full_gym",
      focus: "full_body",
      context: ctx({ readinessScore: 40 }),
      sessions: history,
    });

    const squat = allItems(plan).find((i) => i.name === "Goblet Squat");
    expect(squat).toBeDefined();
    expect(squat!.prescription.kind).toBe("history");
    // 20 * 0.9 = 18 → rounded to the 2.5 step → 17.5
    expect(squat!.prescription.loadText).toBe("17.5 kg");
    expect(plan.notes.join(" ")).toMatch(/lower volume/i);
  });

  it("repeats the load on a standard day", () => {
    const plan = buildWorkoutPlan({
      time: 45,
      equipment: "full_gym",
      focus: "full_body",
      context: ctx({ readinessScore: 65 }),
      sessions: history,
    });

    const squat = allItems(plan).find((i) => i.name === "Goblet Squat");
    expect(squat!.prescription.loadText).toBe("20 kg");
  });

  it("falls back to RPE when the rep range differs too much", () => {
    const highRepHistory = [
      makeSession("2026-07-01", [{ name: "Goblet Squat", weight: "12", reps: 15, sets: 3 }]),
    ];
    const plan = buildWorkoutPlan({
      time: 45,
      equipment: "full_gym",
      focus: "strength",
      context: ctx({ readinessScore: 85, sevenDayLoad: 600 }),
      sessions: highRepHistory,
    });

    const squat = allItems(plan).find((i) => i.name === "Goblet Squat");
    expect(squat!.prescription.kind).toBe("rpe");
    expect(squat!.prescription.loadText).toMatch(/^RPE/);
    // Still shows the real history as context — never hides or invents it.
    expect(squat!.prescription.reference).toContain("15");
  });
});

describe("buildWorkoutPlan — RPE fallback and guardrails", () => {
  it("never invents kg values for a member with no history", () => {
    const plan = buildWorkoutPlan({
      time: 60,
      equipment: "full_gym",
      focus: "full_body",
      context: ctx({ readinessScore: 85, sevenDayLoad: 400 }),
      sessions: [],
    });

    for (const item of allItems(plan)) {
      expect(item.prescription.loadText).not.toMatch(/\d\s*kg/);
      expect(item.prescription.reference).toBeNull();
    }
    expect(plan.historyAnchoredCount).toBe(0);
    expect(plan.notes.join(" ")).toMatch(/no training history/i);
  });

  it("scales the session size with available time", () => {
    const short = buildWorkoutPlan({
      time: 20,
      equipment: "dumbbells",
      focus: "full_body",
      context: ctx(),
      sessions: [],
    });
    const long = buildWorkoutPlan({
      time: 60,
      equipment: "dumbbells",
      focus: "full_body",
      context: ctx(),
      sessions: [],
    });

    expect(allItems(long).length).toBeGreaterThan(allItems(short).length);
  });

  it("only offers equipment-appropriate exercises", () => {
    const plan = buildWorkoutPlan({
      time: 45,
      equipment: "bodyweight",
      focus: "full_body",
      context: ctx(),
      sessions: [],
    });

    const names = allItems(plan).map((i) => i.name.toLowerCase());
    expect(names.some((n) => n.includes("barbell") || n.includes("bench press"))).toBe(false);
  });

  it("auto focus turns a reduced day into a recovery-friendly session", () => {
    const plan = buildWorkoutPlan({
      time: 30,
      equipment: "full_gym",
      focus: "auto",
      context: ctx({ readinessScore: 35 }),
      sessions: [],
    });

    expect(plan.focusLabel).toBe("Recovery");
    for (const item of allItems(plan)) {
      expect(item.prescription.loadText).not.toMatch(/\d\s*kg/);
    }
  });

  it("only offers barbell-appropriate exercises when Barbell is selected", () => {
    const plan = buildWorkoutPlan({
      time: 60,
      equipment: "barbell",
      focus: "full_body",
      context: ctx(),
      sessions: [],
    });

    const names = allItems(plan)
      .filter((i) => i.prescription.kind !== "effort")
      .map((i) => i.name.toLowerCase());
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).not.toMatch(/dumbbell|kettlebell|pulldown|cable|leg press|machine/);
    }
  });

  it("anchors to a familiar barbell lift from history when Barbell is selected", () => {
    const history = [
      makeSession("2026-07-02", [{ name: "Front Squat", weight: "70", reps: 6, sets: 4 }]),
    ];
    const plan = buildWorkoutPlan({
      time: 45,
      equipment: "barbell",
      focus: "strength",
      context: ctx({ readinessScore: 80, sevenDayLoad: 500 }),
      sessions: history,
    });

    const names = allItems(plan).map((i) => i.name);
    // Front Squat is the non-default barbell squat option — chosen because
    // it's the one the member has actually logged.
    expect(names).toContain("Front Squat");
    expect(names).not.toContain("Back Squat");

    const frontSquat = allItems(plan).find((i) => i.name === "Front Squat");
    expect(frontSquat!.prescription.kind).toBe("history");
    expect(frontSquat!.prescription.loadText).toBe("72.5 kg");
    expect(frontSquat!.prescription.reference).toContain("4 × 6 @ 70 kg");
  });

  it("prefers a familiar exercise over the default option", () => {
    const history = [
      makeSession("2026-06-28", [{ name: "Back Squat", weight: "80", reps: 6, sets: 4 }]),
    ];
    const plan = buildWorkoutPlan({
      time: 45,
      equipment: "full_gym",
      focus: "strength",
      context: ctx({ readinessScore: 80, sevenDayLoad: 500 }),
      sessions: history,
    });

    const names = allItems(plan).map((i) => i.name);
    expect(names).toContain("Back Squat");
    expect(names).not.toContain("Goblet Squat");
  });
});
