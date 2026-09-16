import { describe, expect, it } from "vitest";

import { hasAccess, isMembershipTier } from "@/lib/member-access";

describe("isMembershipTier", () => {
  it("is true only for membership tier", () => {
    expect(isMembershipTier("membership")).toBe(true);
    expect(isMembershipTier("app_subscription")).toBe(false);
    expect(isMembershipTier("free")).toBe(false);
  });

  it("stays a strictly narrower gate than hasAccess's app_subscription+ features", () => {
    // hasAccess treats app_subscription and membership as equal for every
    // existing feature — isMembershipTier deliberately doesn't, so an
    // app_subscription member can still have a feature while failing this.
    expect(hasAccess("app_subscription", "aiCoachChat")).toBe(true);
    expect(isMembershipTier("app_subscription")).toBe(false);
  });
});
