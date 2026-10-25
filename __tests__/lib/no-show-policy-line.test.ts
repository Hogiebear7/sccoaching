import { describe, expect, it } from "vitest";

import { noShowPolicyLine } from "@/lib/email-templates";

describe("noShowPolicyLine", () => {
  it("explains the policy on a first miss", () => {
    expect(noShowPolicyLine(1)).toContain("missing 3 classes within a calendar month");
  });
  it("warns about a third on the second miss", () => {
    expect(noShowPolicyLine(2)).toBe(
      "This is your 2nd missed class this month — if you miss a third, your membership may be at risk of suspension."
    );
  });
  it("never says 'if you miss a third' from the third miss on", () => {
    for (const n of [3, 4, 14]) {
      expect(noShowPolicyLine(n)).not.toContain("miss a third");
    }
    expect(noShowPolicyLine(14)).toBe(
      "This is your 14th missed class this month, which puts your membership at risk of suspension. Please talk to your coach if something is getting in the way."
    );
  });
});
