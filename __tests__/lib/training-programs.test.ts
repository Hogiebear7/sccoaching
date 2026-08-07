import { describe, expect, it } from "vitest";

import { parseProgramDays } from "@/lib/training-programs";

describe("parseProgramDays", () => {
  it("rejects an empty or non-array day list", () => {
    expect(parseProgramDays(null)).toEqual({ ok: false, message: "At least one program day is required." });
    expect(parseProgramDays([])).toEqual({ ok: false, message: "At least one program day is required." });
  });

  it("rejects more than 14 days", () => {
    const days = Array.from({ length: 15 }, (_, i) => ({ label: `Day ${i}` }));
    const result = parseProgramDays(days);
    expect(result).toEqual({ ok: false, message: "A program can have at most 14 days." });
  });

  it("requires a label on every day", () => {
    const result = parseProgramDays([{ label: "Workout A" }, { label: "" }]);
    expect(result).toEqual({ ok: false, message: 'Every day needs a label (e.g. "Workout A").' });
  });

  it("defaults an unrecognized type to workout and rest days drop exercises", () => {
    const result = parseProgramDays([
      { label: "Workout A", type: "bogus", exercises: [{ name: "Bench Press" }] },
      { label: "Rest", type: "rest", exercises: [{ name: "Should be dropped" }] },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days[0].type).toBe("workout");
    expect(result.days[0].exercises).toHaveLength(1);
    expect(result.days[1].type).toBe("rest");
    expect(result.days[1].exercises).toEqual([]);
  });

  it("parses prescribed exercises including per-set breakdown, tags, and superset group; drops nameless rows", () => {
    const result = parseProgramDays([
      {
        label: "Workout A",
        exercises: [
          {
            name: "Bench Press",
            muscleTags: ["Chest", "Triceps", 42],
            targetSets: 4,
            targetReps: "8-10",
            setType: "failure",
            supersetGroup: "ss-0",
            sets: [
              { reps: "10", weight: "60kg", setType: "standard" },
              { reps: "8", weight: "70kg", setType: "dropset" },
            ],
          },
          { name: "" },
        ],
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [ex] = result.days[0].exercises;
    expect(result.days[0].exercises).toHaveLength(1);
    expect(ex.name).toBe("Bench Press");
    expect(ex.muscleTags).toEqual(["Chest", "Triceps"]);
    expect(ex.targetSets).toBe(4);
    expect(ex.targetReps).toBe("8-10");
    expect(ex.setType).toBe("failure");
    expect(ex.supersetGroup).toBe("ss-0");
    expect(ex.sets).toEqual([
      { reps: "10", weight: "60kg", setType: "standard" },
      { reps: "8", weight: "70kg", setType: "dropset" },
    ]);
  });

  it("rejects an unknown set type rather than passing it through", () => {
    const result = parseProgramDays([
      { label: "Workout A", exercises: [{ name: "Row", setType: "not-a-real-type" }] },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days[0].exercises[0].setType).toBeNull();
  });
});
