import { describe, expect, it } from "vitest";

import { parseCardioFields, parseExerciseEntries, parseOrder } from "@/lib/workout-entries";

describe("entry order", () => {
  it("accepts a place in the workout and drops anything unusable", () => {
    expect(parseOrder(0)).toBe(0);
    expect(parseOrder(3.7)).toBe(3);
    expect(parseOrder(-1)).toBeNull();
    expect(parseOrder(5000)).toBeNull();
    expect(parseOrder("2")).toBeNull();
    expect(parseOrder(undefined)).toBeNull();
    expect(parseOrder(Number.NaN)).toBeNull();
  });

  it("keeps the order on exercises and leaves it null when none was sent (older apps)", () => {
    const [withOrder, without] = parseExerciseEntries([{ name: "Squat", order: 2 }, { name: "Row" }]);
    expect(withOrder.order).toBe(2);
    expect(without.order).toBeNull();
  });

  it("keeps the order on cardio next to the cardio fields", () => {
    expect(parseCardioFields({ cardioType: "bike", level: 5, order: 1 })).toEqual({ cardioType: "bike", level: 5, order: 1 });
    expect(parseCardioFields({ order: 4 })).toEqual({ order: 4 });
    expect(parseCardioFields({})).toEqual({});
  });

  it("keeps the superset label on cardio, so cardio can sit inside a superset", () => {
    expect(parseCardioFields({ cardioType: "bike", level: null, supersetGroup: "ST2" })).toEqual({ cardioType: "bike", level: null, supersetGroup: "ST2" });
    expect(parseCardioFields({ supersetGroup: "   " })).toEqual({});
    expect(parseCardioFields({ supersetGroup: 7 })).toEqual({});
  });
});

describe("body part of an exercise the member added themselves", () => {
  it("keeps a valid body part and leaves the field off otherwise (library exercises, older apps, junk)", () => {
    const [mine, library, junk, older] = parseExerciseEntries([
      { name: "Sandbag clean", muscleSection: "lower_pull" },
      { name: "Back Squat", exerciseId: "ex-1" },
      { name: "Weird", muscleSection: "not_a_section" },
      { name: "Old entry" },
    ]);
    expect(mine.muscleSection).toBe("lower_pull");
    expect("muscleSection" in library).toBe(false);
    expect("muscleSection" in junk).toBe(false);
    expect("muscleSection" in older).toBe(false);
  });
});
