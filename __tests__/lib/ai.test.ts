import { describe, expect, it } from "vitest";

import { parseProgrammeCheckIn, parseProgrammeSkeleton } from "@/lib/ai";

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

  it("keeps exactly one checkpoint per requested week, dropping duplicates and unrequested weeks", () => {
    const raw = JSON.stringify({
      splitStyle: "Full Body",
      days: [{ label: "Day A", type: "workout", primaryBodyParts: ["chest"], secondaryBodyParts: [], repScheme: "strength" }],
      checkpoints: [
        { weekNumber: 1, label: "Baseline", exercises: [{ name: "5RM Back Squat", protocol: "5RM" }] },
        { weekNumber: 1, label: "Duplicate", exercises: [{ name: "Other", protocol: "AMRAP" }] },
        { weekNumber: 8, label: "Final", exercises: [{ name: "5RM Back Squat", protocol: "5RM" }] },
        { weekNumber: 99, label: "Not requested", exercises: [{ name: "Ghost", protocol: "n/a" }] },
      ],
    });
    const result = parseProgrammeSkeleton(raw, VALID_BODY_PARTS, 1, [1, 8]);
    expect(result?.checkpoints).toHaveLength(2);
    expect(result?.checkpoints.map((c) => c.weekNumber)).toEqual([1, 8]);
    expect(result?.checkpoints[0].label).toBe("Baseline");
  });

  it("drops a checkpoint left with no valid exercises", () => {
    const raw = JSON.stringify({
      splitStyle: "Full Body",
      days: [{ label: "Day A", type: "workout", primaryBodyParts: ["chest"], secondaryBodyParts: [], repScheme: "strength" }],
      checkpoints: [{ weekNumber: 1, label: "Baseline", exercises: [{ name: "", protocol: "" }] }],
    });
    const result = parseProgrammeSkeleton(raw, VALID_BODY_PARTS, 1, [1]);
    expect(result?.checkpoints).toEqual([]);
  });

  it("returns an empty checkpoints array when no checkpoint weeks were requested", () => {
    const raw = JSON.stringify({
      splitStyle: "Full Body",
      days: [{ label: "Day A", type: "workout", primaryBodyParts: ["chest"], secondaryBodyParts: [], repScheme: "strength" }],
      checkpoints: [{ weekNumber: 1, label: "Baseline", exercises: [{ name: "5RM Back Squat", protocol: "5RM" }] }],
    });
    const result = parseProgrammeSkeleton(raw, VALID_BODY_PARTS, 1);
    expect(result?.checkpoints).toEqual([]);
  });

  it("uses the AI-authored rationale when given", () => {
    const raw = JSON.stringify({
      splitStyle: "Full Body",
      rationale: "This balances your goal with a sustainable weekly volume.",
      days: [{ label: "Day A", type: "workout", primaryBodyParts: ["chest"], secondaryBodyParts: [], repScheme: "strength" }],
    });
    const result = parseProgrammeSkeleton(raw, VALID_BODY_PARTS, 1);
    expect(result?.rationale).toBe("This balances your goal with a sustainable weekly volume.");
  });

  it("falls back to a deterministic sentence when rationale is missing, rather than failing generation", () => {
    const raw = JSON.stringify({
      splitStyle: "Full Body",
      days: [{ label: "Day A", type: "workout", primaryBodyParts: ["chest"], secondaryBodyParts: [], repScheme: "strength" }],
    });
    const result = parseProgrammeSkeleton(raw, VALID_BODY_PARTS, 1);
    expect(result?.rationale).toBe("A full body programme built around your stated goal.");
  });
});

describe("parseProgrammeCheckIn", () => {
  it("returns null for malformed JSON", () => {
    expect(parseProgrammeCheckIn("not json", 8)).toBeNull();
  });

  it("returns null when feedbackText is missing or empty", () => {
    expect(parseProgrammeCheckIn(JSON.stringify({ adjustmentProposal: null }), 8)).toBeNull();
    expect(parseProgrammeCheckIn(JSON.stringify({ feedbackText: "  " }), 8)).toBeNull();
  });

  it("accepts a null adjustment proposal", () => {
    const result = parseProgrammeCheckIn(JSON.stringify({ feedbackText: "Solid week.", adjustmentProposal: null }), 8);
    expect(result).toEqual({ feedbackText: "Solid week.", adjustmentProposal: null, exerciseRefreshProposal: null });
  });

  it("accepts an accelerate/hold_back proposal without a week count", () => {
    const raw = JSON.stringify({
      feedbackText: "Great week.",
      adjustmentProposal: { type: "accelerate", rationale: "RIR stayed high all week." },
    });
    const result = parseProgrammeCheckIn(raw, 8);
    expect(result?.adjustmentProposal).toEqual({ type: "accelerate", rationale: "RIR stayed high all week." });
  });

  it("drops an expedite_timeline proposal with an invalid or non-shorter week count", () => {
    const tooLong = JSON.stringify({
      feedbackText: "Ahead of schedule.",
      adjustmentProposal: { type: "expedite_timeline", rationale: "Fast progress.", proposedTotalWeeks: 12 },
    });
    expect(parseProgrammeCheckIn(tooLong, 8)?.adjustmentProposal).toBeNull();

    const notInteger = JSON.stringify({
      feedbackText: "Ahead of schedule.",
      adjustmentProposal: { type: "expedite_timeline", rationale: "Fast progress.", proposedTotalWeeks: "soon" },
    });
    expect(parseProgrammeCheckIn(notInteger, 8)?.adjustmentProposal).toBeNull();
  });

  it("accepts a valid expedite_timeline proposal", () => {
    const raw = JSON.stringify({
      feedbackText: "Ahead of schedule.",
      adjustmentProposal: { type: "expedite_timeline", rationale: "Fast progress.", proposedTotalWeeks: 6 },
    });
    const result = parseProgrammeCheckIn(raw, 8);
    expect(result?.adjustmentProposal).toEqual({
      type: "expedite_timeline",
      rationale: "Fast progress.",
      proposedTotalWeeks: 6,
    });
  });

  it("rejects an unrecognized proposal type", () => {
    const raw = JSON.stringify({
      feedbackText: "Fine week.",
      adjustmentProposal: { type: "double_the_weight", rationale: "..." },
    });
    expect(parseProgrammeCheckIn(raw, 8)?.adjustmentProposal).toBeNull();
  });

  it("drops an exerciseRefreshProposal when the week wasn't actually refresh-eligible", () => {
    const raw = JSON.stringify({
      feedbackText: "Fine week.",
      adjustmentProposal: null,
      exerciseRefreshProposal: { rationale: "Time for something new." },
    });
    // refreshEligible defaults to false — a stray proposal must never be trusted.
    expect(parseProgrammeCheckIn(raw, 8)?.exerciseRefreshProposal).toBeNull();
  });

  it("accepts an exerciseRefreshProposal only when the week is actually refresh-eligible", () => {
    const raw = JSON.stringify({
      feedbackText: "Great consistency this month.",
      adjustmentProposal: null,
      exerciseRefreshProposal: { rationale: "You've run these same movements for a month — time to mix it up." },
    });
    const result = parseProgrammeCheckIn(raw, 8, true);
    expect(result?.exerciseRefreshProposal).toEqual({
      rationale: "You've run these same movements for a month — time to mix it up.",
    });
  });

  it("drops an exerciseRefreshProposal with an empty rationale even when eligible", () => {
    const raw = JSON.stringify({
      feedbackText: "Great week.",
      adjustmentProposal: null,
      exerciseRefreshProposal: { rationale: "  " },
    });
    expect(parseProgrammeCheckIn(raw, 8, true)?.exerciseRefreshProposal).toBeNull();
  });
});
