import { describe, expect, it } from "vitest";

import type { ExerciseLibraryRecord } from "@/lib/exercise-library/types";
import { pickExercisesForDay, pickStructuredExercisesForDay, resolveSplitMode } from "@/lib/programme-exercise-picker";

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

describe("resolveSplitMode", () => {
  it("always resolves to freeform for 'Build muscle', regardless of split preference", () => {
    expect(resolveSplitMode("Build muscle", "fullBody")).toBe("freeform");
    expect(resolveSplitMode("Build muscle", "upperLower")).toBe("freeform");
    expect(resolveSplitMode("Build muscle", null)).toBe("freeform");
  });

  it("uses the member's split preference for any other goal", () => {
    expect(resolveSplitMode("Build strength", "upperLower")).toBe("upperLower");
    expect(resolveSplitMode("Sports performance", "fullBody")).toBe("fullBody");
  });

  it("defaults to fullBody when no preference is given", () => {
    expect(resolveSplitMode("Build strength", null)).toBe("fullBody");
  });
});

describe("pickStructuredExercisesForDay", () => {
  // One compound + one isolation candidate per main bucket, plus a core and
  // a tempo exercise — mirrors the real taxonomy shapes confirmed live
  // against the exercise library.
  const structuredLibrary: ExerciseLibraryRecord[] = [
    makeExercise({
      id: "bench",
      name: "Barbell Bench Press",
      bodyPart: "chest",
      equipment: "barbell",
      taxonomy: { forceType: "push", primaryRegion: "upper_body", mechanic: "compound" },
    }),
    makeExercise({
      id: "cable-fly",
      name: "Cable Fly",
      bodyPart: "chest",
      equipment: "cable",
      taxonomy: { forceType: "push", primaryRegion: "upper_body", mechanic: "isolation" },
    }),
    makeExercise({
      id: "pullup",
      name: "Pull-Up",
      bodyPart: "back",
      equipment: null,
      taxonomy: { forceType: "pull", primaryRegion: "upper_body", mechanic: "compound" },
    }),
    makeExercise({
      id: "face-pull",
      name: "Face Pull",
      bodyPart: "back",
      equipment: "cable",
      taxonomy: { forceType: "pull", primaryRegion: "upper_body", mechanic: "isolation" },
    }),
    makeExercise({
      id: "squat",
      name: "Barbell Squat",
      bodyPart: "upper legs",
      equipment: "barbell",
      taxonomy: { forceType: "knee_dominant", primaryRegion: "lower_body", mechanic: "compound" },
    }),
    makeExercise({
      id: "leg-ext",
      name: "Leg Extension",
      bodyPart: "upper legs",
      equipment: "leverage machine",
      taxonomy: { forceType: "knee_dominant", primaryRegion: "lower_body", mechanic: "isolation" },
    }),
    makeExercise({
      id: "deadlift",
      name: "Barbell Deadlift",
      bodyPart: "upper legs",
      equipment: "barbell",
      taxonomy: { forceType: "hip_dominant", primaryRegion: "lower_body", mechanic: "compound" },
    }),
    makeExercise({
      id: "glute-bridge",
      name: "Glute Bridge",
      bodyPart: "upper legs",
      equipment: null,
      taxonomy: { forceType: "hip_dominant", primaryRegion: "lower_body", mechanic: "isolation" },
    }),
    makeExercise({
      id: "plank",
      name: "Plank",
      bodyPart: "waist",
      equipment: null,
      taxonomy: { forceType: "core_stability", primaryRegion: "core", mechanic: "core" },
    }),
    makeExercise({
      id: "battle-ropes",
      name: "Battle Ropes",
      bodyPart: "cardio",
      equipment: null,
      taxonomy: { forceType: "locomotion", primaryRegion: "cardio", mechanic: "cardio" },
    }),
  ];

  it("at a 45-min session (6 slots), fullBody picks one compound main per bucket plus tempo and core, finishers last", () => {
    const picks = pickStructuredExercisesForDay({
      exercises: structuredLibrary,
      daySpec: { mode: "fullBody" },
      equipmentSlugs: [],
      timeMinutes: 45,
    });
    expect(picks).toHaveLength(6);
    const names = picks.map((p) => p.name);
    expect(new Set(names)).toEqual(
      new Set(["Barbell Bench Press", "Pull-Up", "Barbell Squat", "Barbell Deadlift", "Battle Ropes", "Plank"])
    );
    // Finishers are always the literal last two, tempo before core.
    expect(names[4]).toBe("Battle Ropes");
    expect(names[5]).toBe("Plank");
  });

  it("at a 40-min session (5 slots), gets the 4 compound mains plus exactly one finisher", () => {
    const picks = pickStructuredExercisesForDay({
      exercises: structuredLibrary,
      daySpec: { mode: "fullBody" },
      equipmentSlugs: [],
      timeMinutes: 40,
    });
    expect(picks).toHaveLength(5);
    const mainNames = new Set(picks.slice(0, 4).map((p) => p.name));
    expect(mainNames).toEqual(new Set(["Barbell Bench Press", "Pull-Up", "Barbell Squat", "Barbell Deadlift"]));
    expect(["Battle Ropes", "Plank"]).toContain(picks[4].name);
  });

  it("at a 16-min session (2 slots), fills only main slots — no finisher fits", () => {
    const picks = pickStructuredExercisesForDay({
      exercises: structuredLibrary,
      daySpec: { mode: "fullBody" },
      equipmentSlugs: [],
      timeMinutes: 16,
    });
    expect(picks).toHaveLength(2);
    for (const p of picks) {
      expect(["Battle Ropes", "Plank"]).not.toContain(p.name);
    }
  });

  it("upperLower mode never draws from the opposite half's main buckets", () => {
    const picks = pickStructuredExercisesForDay({
      exercises: structuredLibrary,
      daySpec: { mode: "upperLower", half: "upper" },
      equipmentSlugs: [],
      timeMinutes: 48,
    });
    // N=2 buckets, totalSlots=6 -> mainCount=4 (each upper bucket picked
    // twice, compound then isolation once the compound is exhausted) + both
    // finishers.
    expect(picks).toHaveLength(6);
    const names = new Set(picks.map((p) => p.name));
    expect(names).toEqual(new Set(["Barbell Bench Press", "Pull-Up", "Cable Fly", "Face Pull", "Battle Ropes", "Plank"]));
    for (const lowerName of ["Barbell Squat", "Leg Extension", "Barbell Deadlift", "Glute Bridge"]) {
      expect(names.has(lowerName)).toBe(false);
    }
  });

  it("upperLower mode with half='lower' only draws from lower main buckets", () => {
    const picks = pickStructuredExercisesForDay({
      exercises: structuredLibrary,
      daySpec: { mode: "upperLower", half: "lower" },
      equipmentSlugs: [],
      timeMinutes: 48,
    });
    const names = new Set(picks.map((p) => p.name));
    for (const upperName of ["Barbell Bench Press", "Cable Fly", "Pull-Up", "Face Pull"]) {
      expect(names.has(upperName)).toBe(false);
    }
  });

  it("never picks the same exercise twice across calls sharing alreadyChosenIds", () => {
    const alreadyChosenIds = new Set<string>();
    const day1 = pickStructuredExercisesForDay({
      exercises: structuredLibrary,
      daySpec: { mode: "fullBody" },
      equipmentSlugs: [],
      timeMinutes: 45,
      alreadyChosenIds,
    });
    const day2 = pickStructuredExercisesForDay({
      exercises: structuredLibrary,
      daySpec: { mode: "fullBody" },
      equipmentSlugs: [],
      timeMinutes: 45,
      alreadyChosenIds,
    });
    const day1Ids = new Set(day1.map((p) => p.id));
    for (const p of day2) {
      expect(day1Ids.has(p.id)).toBe(false);
    }
  });

  it("falls back to the freeform body-part picker when nothing classifies into any movement bucket", () => {
    const unclassifiable: ExerciseLibraryRecord[] = [
      makeExercise({
        id: "curl-1",
        name: "Bicep Curl",
        bodyPart: "upper arms",
        equipment: null,
        taxonomy: { forceType: "raise", primaryRegion: "upper_body", mechanic: "isolation" },
      }),
      makeExercise({
        id: "curl-2",
        name: "Hammer Curl",
        bodyPart: "upper arms",
        equipment: null,
        taxonomy: { forceType: "raise", primaryRegion: "upper_body", mechanic: "isolation" },
      }),
    ];
    const picks = pickStructuredExercisesForDay({
      exercises: unclassifiable,
      daySpec: { mode: "fullBody" },
      equipmentSlugs: [],
      timeMinutes: 30,
    });
    expect(picks.length).toBeGreaterThan(0);
    for (const p of picks) {
      expect(["Bicep Curl", "Hammer Curl"]).toContain(p.name);
    }
  });
});
