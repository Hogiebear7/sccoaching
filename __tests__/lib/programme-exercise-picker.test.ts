import { describe, expect, it } from "vitest";

import type { ExerciseLibraryRecord } from "@/lib/exercise-library/types";
import { pickExercisesForDay } from "@/lib/programme-exercise-picker";

function makeExercise(overrides: Partial<ExerciseLibraryRecord> = {}): ExerciseLibraryRecord {
  return {
    id: overrides.id ?? "ex-1",
    source: "test",
    sourceId: null,
    slug: overrides.id ?? "ex-1",
    name: overrides.name ?? "Test Exercise",
    aliases: [],
    bodyPart: overrides.bodyPart ?? "chest",
    targetMuscle: null,
    secondaryMuscles: [],
    equipment: overrides.equipment ?? null,
    category: null,
    difficulty: null,
    description: null,
    instructions: [],
    taxonomy: null,
    isCustom: false,
    approved: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("pickExercisesForDay", () => {
  const library: ExerciseLibraryRecord[] = [
    makeExercise({ id: "bench", name: "Bench Press", bodyPart: "chest", equipment: "barbell" }),
    makeExercise({ id: "flye", name: "Dumbbell Flye", bodyPart: "chest", equipment: "dumbbell" }),
    makeExercise({ id: "pushup", name: "Push-Up", bodyPart: "chest", equipment: null }),
    makeExercise({ id: "row", name: "Barbell Row", bodyPart: "back", equipment: "barbell" }),
  ];

  it("only picks exercises matching the given equipment (or requiring none)", () => {
    const picks = pickExercisesForDay({
      exercises: library,
      primaryBodyParts: ["chest"],
      secondaryBodyParts: [],
      equipmentSlugs: ["dumbbell"],
      timeMinutes: 60,
    });
    const names = picks.map((p) => p.name);
    expect(names).not.toContain("Bench Press");
    expect(names.some((n) => n === "Dumbbell Flye" || n === "Push-Up")).toBe(true);
  });

  it("never invents a weight or a target rep count — that's a later step", () => {
    const picks = pickExercisesForDay({
      exercises: library,
      primaryBodyParts: ["chest"],
      secondaryBodyParts: [],
      equipmentSlugs: [],
      timeMinutes: 30,
    });
    for (const p of picks) {
      expect(p.targetWeight).toBeNull();
      expect(p.targetSets).toBeNull();
      expect(p.targetReps).toBeNull();
    }
  });

  it("never picks the same exercise twice, even across calls sharing alreadyChosenIds", () => {
    const alreadyChosenIds = new Set<string>();
    const day1 = pickExercisesForDay({
      exercises: library,
      primaryBodyParts: ["chest"],
      secondaryBodyParts: [],
      equipmentSlugs: [],
      timeMinutes: 60,
      alreadyChosenIds,
    });
    const day2 = pickExercisesForDay({
      exercises: library,
      primaryBodyParts: ["chest"],
      secondaryBodyParts: [],
      equipmentSlugs: [],
      timeMinutes: 60,
      alreadyChosenIds,
    });
    const day1Ids = new Set(day1.map((p) => p.id));
    for (const p of day2) {
      expect(day1Ids.has(p.id)).toBe(false);
    }
  });

  it("returns an empty list gracefully when no exercise matches the requested body part", () => {
    const picks = pickExercisesForDay({
      exercises: library,
      primaryBodyParts: ["nonexistent-body-part"],
      secondaryBodyParts: [],
      equipmentSlugs: [],
      timeMinutes: 45,
    });
    expect(picks).toEqual([]);
  });
});
