import { describe, expect, it } from "vitest";

import { parseProgrammeSkeleton } from "@/lib/ai";

const VALID_BODY_PARTS = ["chest", "back", "upper legs", "shoulders", "upper arms"];

describe("parseProgrammeSkeleton", () => {
  it("returns null for malformed JSON", () => {
    expect(parseProgrammeSkeleton("not json", VALID_BODY_PARTS, 3)).toBeNull();
  });

  it("returns null when days is missing or not an array", () => {
    expect(parseProgrammeSkeleton(JSON.stringify({ splitStyle: "Full Body" }), VALID_BODY_PARTS, 3)).toBeNull();
    expect(parseProgrammeSkeleton(JSON.stringify({ splitStyle: "x", days: "nope" }), VALID_BODY_PARTS, 3)).toBeNull();
  });

  it("drops invalid body-part values rather than trusting them", () => {
    const raw = JSON.stringify({
      splitStyle: "Full Body",
      days: [
        {
          label: "Day A",
          type: "workout",
          primaryBodyParts: ["chest", "made-up-part"],
          secondaryBodyParts: ["also-fake"],
          repScheme: "hypertrophy",
        },
      ],
    });
    const result = parseProgrammeSkeleton(raw, VALID_BODY_PARTS, 1);
    expect(result?.days[0].primaryBodyParts).toEqual(["chest"]);
    expect(result?.days[0].secondaryBodyParts).toEqual([]);
  });

  it("falls back to a real body part when a workout day ends up with none", () => {
    const raw = JSON.stringify({
      splitStyle: "Full Body",
      days: [{ label: "Day A", type: "workout", primaryBodyParts: ["nonsense"], secondaryBodyParts: [], repScheme: "strength" }],
    });
    const result = parseProgrammeSkeleton(raw, VALID_BODY_PARTS, 1);
    expect(result?.days[0].primaryBodyParts).toEqual([VALID_BODY_PARTS[0]]);
  });

  it("preserves rest days with no body parts required", () => {
    const raw = JSON.stringify({
      splitStyle: "Upper/Lower",
      days: [
        { label: "Upper", type: "workout", primaryBodyParts: ["chest"], secondaryBodyParts: [], repScheme: "hypertrophy" },
        { label: "Rest", type: "rest" },
      ],
    });
    const result = parseProgrammeSkeleton(raw, VALID_BODY_PARTS, 2);
    expect(result?.days[1]).toMatchObject({ label: "Rest", type: "rest", primaryBodyParts: [] });
  });

  it("rejects an invalid repScheme rather than trusting it", () => {
    const raw = JSON.stringify({
      splitStyle: "Full Body",
      days: [{ label: "Day A", type: "workout", primaryBodyParts: ["chest"], secondaryBodyParts: [], repScheme: "extreme" }],
    });
    const result = parseProgrammeSkeleton(raw, VALID_BODY_PARTS, 1);
    expect(result?.days[0].repScheme).toBeNull();
  });

  it("returns null for an empty days array", () => {
    expect(parseProgrammeSkeleton(JSON.stringify({ splitStyle: "x", days: [] }), VALID_BODY_PARTS, 3)).toBeNull();
  });

  it("strips a markdown code fence before parsing", () => {
    const raw = "```json\n" + JSON.stringify({
      splitStyle: "Full Body",
      days: [{ label: "Day A", type: "workout", primaryBodyParts: ["chest"], secondaryBodyParts: [], repScheme: "strength" }],
    }) + "\n```";
    const result = parseProgrammeSkeleton(raw, VALID_BODY_PARTS, 1);
    expect(result?.splitStyle).toBe("Full Body");
  });
});
