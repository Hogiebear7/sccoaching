import { describe, expect, it } from "vitest";

import { cyclePauseFor, pausedPhase } from "@/lib/cycle-phase";
import { isMenopauseStage, menopauseContentFor } from "@/lib/menopause";

describe("menopause content", () => {
  it("labels every point with its evidence and never claims exercise treats hot flushes", () => {
    for (const stage of ["perimenopause", "postmenopause"] as const) {
      const c = menopauseContentFor(stage)!;
      for (const p of [...c.training, ...c.nutrition, ...c.recovery]) {
        expect(["Strong evidence", "Good evidence", "Expert advice"]).toContain(p.evidence);
      }
      expect(c.training.map((p) => p.text).join(" ")).toMatch(/hasn't been shown to reduce hot flushes/);
      expect(c.disclaimer).toMatch(/GP/);
    }
    expect(menopauseContentFor(null)).toBeNull();
  });

  it("accepts only the two stages", () => {
    expect(isMenopauseStage("perimenopause")).toBe(true);
    expect(isMenopauseStage("menopause")).toBe(false);
  });

  it("explains a post-menopause pause", () => {
    expect(pausedPhase("postmenopause").explanation).toMatch(/post-menopause/);
    expect(cyclePauseFor(null, "2026-10-01")).toBeNull();
  });
});
