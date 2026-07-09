import { describe, expect, it } from "vitest";

import { buildSuggestedPrompts } from "@/app/(dashboard)/dashboard/messages/AiChat";
import { DEFAULT_DRINK_SETTINGS } from "@/lib/drink-settings";
import type { CoachingContextDisplay } from "@/lib/ai-context";

const CONTEXT: CoachingContextDisplay = {
  readinessScore: 82,
  readinessDelta: 6,
  loadBand: "moderate",
  loadBandLabel: "Moderate",
  sessionCount: 5,
  tierLabel: "Standard session",
};

describe("buildSuggestedPrompts — drink settings", () => {
  it("shows no drink prompts without settings", () => {
    const prompts = buildSuggestedPrompts(CONTEXT, null);
    expect(prompts.join("\n")).not.toMatch(/drink/i);
    expect(prompts).toContain("How hard should I push today?");
  });

  it("adds salt and bottle prompts for a team sport", () => {
    const prompts = buildSuggestedPrompts(CONTEXT, DEFAULT_DRINK_SETTINGS);
    expect(prompts).toContain("Why this much salt in my drink?");
    expect(prompts).toContain("Why this bottle size for match day?");
  });

  it("asks the no-carry question only for short runs", () => {
    const shortRun = buildSuggestedPrompts(CONTEXT, {
      ...DEFAULT_DRINK_SETTINGS,
      sport: "run",
      role: "",
      runKm: 3,
      runEffort: "easy", // ~20 min
    });
    expect(shortRun).toContain("Why is no carried drink needed for my run?");

    const longRun = buildSuggestedPrompts(CONTEXT, {
      ...DEFAULT_DRINK_SETTINGS,
      sport: "run",
      role: "",
      runKm: 21.1,
      runEffort: "steady", // ~115 min
    });
    expect(longRun).toContain("How should I carry fluids on this run?");
    expect(longRun).not.toContain("Why is no carried drink needed for my run?");
  });

  it("keeps the list compact", () => {
    expect(buildSuggestedPrompts(CONTEXT, DEFAULT_DRINK_SETTINGS).length).toBeLessThanOrEqual(6);
    expect(buildSuggestedPrompts(null, null).length).toBeLessThanOrEqual(6);
  });
});
