import { describe, expect, it } from "vitest";

import { parseCardioFields } from "@/lib/workout-entries";

describe("parseCardioFields", () => {
  it("keeps a known cardio type and a sensible level", () => {
    expect(parseCardioFields({ cardioType: "stair_climber", level: 8 })).toEqual({ cardioType: "stair_climber", level: 8 });
    expect(parseCardioFields({ cardioType: "treadmill_walk", level: 12.25 })).toEqual({ cardioType: "treadmill_walk", level: 12.3 });
  });

  it("leaves older run entries untouched and drops junk", () => {
    expect(parseCardioFields({})).toEqual({});
    expect(parseCardioFields({ cardioType: "skydiving" })).toEqual({});
    expect(parseCardioFields({ cardioType: "bike", level: 99 })).toEqual({ cardioType: "bike", level: null });
  });
});
