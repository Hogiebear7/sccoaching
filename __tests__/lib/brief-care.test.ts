import { describe, expect, it } from "vitest";

import { buildCareCards, conditionFlags, type CareInputs } from "@/lib/brief-care";

const base: CareInputs = { sharedStage: null, checkInNote: null, signupInfo: null, signupMedicalNotes: null, medicalPicks: [], coachNote: null };

describe("brief care cards", () => {
  it("shows nothing at all when there is nothing to show", () => {
    expect(buildCareCards(base)).toEqual([]);
  });

  it("says nothing about pregnancy unless a shared stage is passed", () => {
    const cards = buildCareCards({ ...base, signupInfo: "Fine" });
    expect(cards.find((c) => c.id === "pregnancy")).toBeUndefined();
  });

  it("2nd trimester includes the back-lying advice with its reason, and the stop signs", () => {
    const [card] = buildCareCards({ ...base, sharedStage: { kind: "pregnant", trimester: 2, weeksPregnant: 24 } });
    expect(card.title).toBe("Pregnant: 24 weeks (2nd trimester)");
    const text = card.lines.join("\n");
    expect(text).toContain("lying flat on her back");
    expect(text).toContain("Why:");
    expect(text).toContain("bleeding");
    expect(text).toContain("5 to 7 out of 10");
  });

  it("3rd trimester lowers the effort", () => {
    const [card] = buildCareCards({ ...base, sharedStage: { kind: "pregnant", trimester: 3, weeksPregnant: 32 } });
    expect(card.lines.join("\n")).toContain("4 to 6 out of 10");
  });

  it("postnatal is cautious about running and impact, with the reason", () => {
    const [card] = buildCareCards({ ...base, sharedStage: { kind: "postpartum", weeksSinceBirth: 6, breastfeeding: false } });
    expect(card.title).toBe("Postnatal: 6 weeks since the birth");
    expect(card.lines.join("\n")).toContain("cautious and mindful of running or impact");
    expect(card.lines.join("\n")).toContain("Why:");
  });

  it("an injury note gives the injury card, an illness note gives the illness card, both give both", () => {
    expect(buildCareCards({ ...base, checkInNote: "sore knee, sprained it" }).map((c) => c.id)).toEqual(["injury"]);
    expect(buildCareCards({ ...base, checkInNote: "have a fever and feel sick" }).map((c) => c.id)).toEqual(["illness"]);
    expect(buildCareCards({ ...base, checkInNote: "flu and a pulled hamstring" }).map((c) => c.id)).toEqual(["injury", "illness"]);
    expect(buildCareCards({ ...base, checkInNote: "feeling great" })).toEqual([]);
  });

  it("health notes show the member's own words, the picks and the coach note", () => {
    const [card] = buildCareCards({
      ...base,
      signupInfo: "Left knee surgery 2024",
      medicalPicks: ["Diabetes"],
      coachNote: "Prefers no overhead pressing.",
    });
    expect(card.id).toBe("health_notes");
    const text = card.lines.join("\n");
    expect(text).toContain('From sign-up: "Left knee surgery 2024"');
    expect(text).toContain("Medical (selected at sign-up): Diabetes");
    expect(text).toContain('Coach note: "Prefers no overhead pressing."');
    expect(card.tone).toBe("caution");
  });

  it("only diabetes gets a specific question; blood pressure is a plain flag", () => {
    const flags = conditionFlags(["Type 2 diabetes and high blood pressure"]);
    expect(flags.map((f) => f.code)).toEqual(["diabetes", "blood_pressure"]);
    expect(flags[0].ask).toContain("fast sugar");
    expect(flags[1].ask).toBeUndefined();
  });

  it("a coach note alone with no condition is a plain note card", () => {
    const [card] = buildCareCards({ ...base, coachNote: "Likes early classes." });
    expect(card.tone).toBe("note");
    expect(card.lines.some((l) => l.startsWith("Flag:"))).toBe(false);
  });
});
