import { describe, expect, it } from "vitest";

import { sameGym } from "@/lib/gym-scope";

describe("sameGym", () => {
  it("treats two accounts with no gymId as the same (primary) gym", () => {
    expect(sameGym({}, {})).toBe(true);
    expect(sameGym({ gymId: null }, { gymId: undefined })).toBe(true);
  });

  it("treats a real gymId as different from the primary gym", () => {
    expect(sameGym({ gymId: "gym-2" }, {})).toBe(false);
    expect(sameGym({}, { gymId: "gym-2" })).toBe(false);
  });

  it("treats two accounts with matching real gymIds as the same gym", () => {
    expect(sameGym({ gymId: "gym-2" }, { gymId: "gym-2" })).toBe(true);
  });

  it("treats two accounts with different real gymIds as different gyms", () => {
    expect(sameGym({ gymId: "gym-2" }, { gymId: "gym-3" })).toBe(false);
  });
});
