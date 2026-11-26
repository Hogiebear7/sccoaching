// A category that only held the trial pass is hidden entirely once the member can no longer buy it, instead of showing as "Coming soon".
import { describe, expect, it } from "vitest";

import { withoutCategoriesEmptiedByTrialRule } from "@/lib/intro-pass";

const cats = [{ id: "classes" }, { id: "trial" }, { id: "teaser" }, { id: "mixed" }];

describe("withoutCategoriesEmptiedByTrialRule", () => {
  it("hides a category whose only package was a trial pass the member cannot buy", () => {
    const out = withoutCategoriesEmptiedByTrialRule(cats, new Set(["trial"]), new Set(["classes", "mixed"]));
    expect(out.map((c) => c.id)).toEqual(["classes", "teaser", "mixed"]);
  });

  it("keeps a category that lost a trial pass but still has something to buy", () => {
    const out = withoutCategoriesEmptiedByTrialRule(cats, new Set(["mixed"]), new Set(["mixed"]));
    expect(out.map((c) => c.id)).toContain("mixed");
  });

  it("leaves a category with no packages at all (a deliberate teaser) alone", () => {
    const out = withoutCategoriesEmptiedByTrialRule(cats, new Set(["trial"]), new Set());
    expect(out.map((c) => c.id)).toContain("teaser");
  });

  it("changes nothing when no trial pass was hidden (the member can still buy it)", () => {
    expect(withoutCategoriesEmptiedByTrialRule(cats, new Set(), new Set(["trial"]))).toEqual(cats);
  });
});
