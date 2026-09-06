import { describe, expect, it } from "vitest";

import { bodyHalfOfBucket, classifyMovementBucket, isCompoundExercise, MAIN_MOVEMENT_BUCKETS } from "@/lib/movement-buckets";

describe("classifyMovementBucket", () => {
  it("classifies a barbell bench press as upper_push", () => {
    expect(classifyMovementBucket({ forceType: "push", primaryRegion: "upper_body", mechanic: "compound" })).toBe("upper_push");
  });

  it("classifies a pull-up as upper_pull", () => {
    expect(classifyMovementBucket({ forceType: "pull", primaryRegion: "upper_body", mechanic: "compound" })).toBe("upper_pull");
  });

  it("classifies a barbell squat as lower_push", () => {
    expect(classifyMovementBucket({ forceType: "knee_dominant", primaryRegion: "lower_body", mechanic: "compound" })).toBe(
      "lower_push"
    );
  });

  it("classifies a leg press (lower-body push, not knee_dominant) as lower_push too", () => {
    expect(classifyMovementBucket({ forceType: "push", primaryRegion: "lower_body", mechanic: "compound" })).toBe("lower_push");
  });

  // Real taxonomy confirmed live against the exercise library: kettlebell
  // swing, deadlift, and RDL are all {mechanic: "compound", forceType:
  // "hip_dominant", primaryRegion: "lower_body"} — this is the exact case
  // the member's "kettlebell swing can be a main lift OR a finisher, never
  // both" concern turned on. It resolves for free: this taxonomy shape only
  // ever classifies as lower_pull, never tempo, so a swing used as the
  // day's lower_pull main lift can't also be picked as the tempo finisher.
  it("classifies kettlebell swing / deadlift / RDL taxonomy as lower_pull, never tempo", () => {
    const swingTaxonomy = { forceType: "hip_dominant", primaryRegion: "lower_body", mechanic: "compound" };
    expect(classifyMovementBucket(swingTaxonomy)).toBe("lower_pull");
    expect(classifyMovementBucket(swingTaxonomy)).not.toBe("tempo");
  });

  it("classifies any core-region exercise as core regardless of forceType", () => {
    expect(classifyMovementBucket({ forceType: "core_flexion", primaryRegion: "core", mechanic: "core" })).toBe("core");
    // A hip-dominant exercise tagged core region (e.g. some glute-bridge
    // variants) lands in core, not lower_pull — the region check wins.
    expect(classifyMovementBucket({ forceType: "hip_dominant", primaryRegion: "core", mechanic: "compound" })).toBe("core");
  });

  it("classifies cardio-region, plyometric, complex, and carry exercises as tempo", () => {
    expect(classifyMovementBucket({ forceType: "locomotion", primaryRegion: "cardio", mechanic: "cardio" })).toBe("tempo");
    expect(classifyMovementBucket({ forceType: "explosive", primaryRegion: "lower_body", mechanic: "plyometric" })).toBe("tempo");
    expect(classifyMovementBucket({ forceType: "complex", primaryRegion: "full_body", mechanic: "complex" })).toBe("tempo");
    expect(classifyMovementBucket({ forceType: "carry", primaryRegion: "full_body", mechanic: "complex" })).toBe("tempo");
  });

  it("returns null for exercises that don't fit any of the 6 buckets", () => {
    expect(classifyMovementBucket({ forceType: "raise", primaryRegion: "upper_body", mechanic: "isolation" })).toBeNull();
    expect(classifyMovementBucket({ forceType: "mobility", primaryRegion: "lower_body", mechanic: "mobility" })).toBeNull();
    expect(classifyMovementBucket(null)).toBeNull();
    expect(classifyMovementBucket({})).toBeNull();
  });
});

describe("isCompoundExercise", () => {
  it("is true only for mechanic === 'compound'", () => {
    expect(isCompoundExercise({ mechanic: "compound" })).toBe(true);
    expect(isCompoundExercise({ mechanic: "isolation" })).toBe(false);
    expect(isCompoundExercise(null)).toBe(false);
  });
});

describe("bodyHalfOfBucket", () => {
  it("maps upper buckets to upper and lower buckets to lower", () => {
    expect(bodyHalfOfBucket("upper_push")).toBe("upper");
    expect(bodyHalfOfBucket("upper_pull")).toBe("upper");
    expect(bodyHalfOfBucket("lower_push")).toBe("lower");
    expect(bodyHalfOfBucket("lower_pull")).toBe("lower");
  });

  it("MAIN_MOVEMENT_BUCKETS covers exactly the 4 main buckets", () => {
    expect(MAIN_MOVEMENT_BUCKETS.sort()).toEqual(["lower_pull", "lower_push", "upper_pull", "upper_push"].sort());
  });
});
