import { describe, expect, it } from "vitest";

import { cyclePauseFor, pausedPhase } from "@/lib/cycle-phase";

const pregnant = (dueDate: string, birthDate: string | null = null) => ({ isPregnant: true, dueDate, birthDate });

describe("cyclePauseFor", () => {
  it("is not paused without a pregnancy", () => {
    expect(cyclePauseFor(null, "2026-10-01", "2026-10-20")).toBeNull();
    expect(cyclePauseFor({ isPregnant: false, dueDate: null }, "2026-10-01", "2026-10-20")).toBeNull();
  });

  it("pauses for the whole pregnancy, whatever the old period dates say", () => {
    expect(cyclePauseFor(pregnant("2027-05-20"), "2026-08-10", "2026-10-26")).toBe("pregnancy");
  });

  it("pauses after the birth until a period after the birth is logged", () => {
    expect(cyclePauseFor(pregnant("2027-05-20", "2027-05-14"), "2026-08-10", "2027-06-01")).toBe("postpartum");
    expect(cyclePauseFor(pregnant("2027-05-20", "2027-05-14"), "2027-08-02", "2027-08-10")).toBeNull();
  });

  it("uses the due date as the birth date until one is set", () => {
    expect(cyclePauseFor(pregnant("2027-05-20"), "2026-08-10", "2027-05-19")).toBe("pregnancy");
    expect(cyclePauseFor(pregnant("2027-05-20"), "2026-08-10", "2027-05-25")).toBe("postpartum");
  });

  it("a paused estimate has no phase and says why", () => {
    const p = pausedPhase("pregnancy", 28);
    expect(p.phase).toBe("Unknown");
    expect(p.pausedFor).toBe("pregnancy");
    expect(p.explanation).toMatch(/paused while you're pregnant/);
  });
});
