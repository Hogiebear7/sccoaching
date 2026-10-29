import { describe, expect, it } from "vitest";

import { memberListGroup } from "@/lib/member-list-group";

const GYM = { deliveryChannel: "in_person" as const };
const APP = { deliveryChannel: "app_only" as const };
const find = (id: string) => (id === "gym" ? GYM : id === "app" ? APP : undefined);

describe("memberListGroup — the staff member list groups (owner request 2026-10-29)", () => {
  it("a gym package that is active or past due is current", () => {
    expect(memberListGroup({ packageId: "gym", status: "active" }, find)).toBe("current");
    expect(memberListGroup({ packageId: "gym", status: "past_due" }, find)).toBe("current");
  });
  it("paused stays visible as its own group", () => {
    expect(memberListGroup({ packageId: "gym", status: "paused" }, find)).toBe("paused");
  });
  it("an ended gym package is past", () => {
    expect(memberListGroup({ packageId: "gym", status: "canceled" }, find)).toBe("past");
    expect(memberListGroup({ packageId: "gym", status: "inactive" }, find)).toBe("past");
  });
  it("no package, the App Subscription only, an unknown package, or a pending checkout is none", () => {
    expect(memberListGroup(undefined, find)).toBe("none");
    expect(memberListGroup({ packageId: null, status: "active" }, find)).toBe("none");
    expect(memberListGroup({ packageId: "app", status: "active" }, find)).toBe("none");
    expect(memberListGroup({ packageId: "gone", status: "active" }, find)).toBe("none");
    expect(memberListGroup({ packageId: "gym", status: "pending" }, find)).toBe("none");
  });
});
