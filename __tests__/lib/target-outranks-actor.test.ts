// targetOutranksActor (lib/platform-operator-guard.ts): true only when the
// target's role ranks STRICTLY above the actor's, using the canonical rank in
// lib/permissions.ts. Equal and lower ranks are never blocked by it, the legacy
// "staff" alias ranks as admin_manager, and null/undefined/unknown roles rank as
// member (lowest) so they never outrank anyone and never look "higher" than a
// real role.
import { describe, expect, it } from "vitest";

import { roleRank } from "@/lib/permissions";
import { targetOutranksActor } from "@/lib/platform-operator-guard";

const r = (role: string | null | undefined) => ({ role });

describe("roleRank", () => {
  it("orders the roles member < coach < admin < admin_manager < platform_operator, with staff == admin_manager", () => {
    expect(roleRank("member")).toBeLessThan(roleRank("coach"));
    expect(roleRank("coach")).toBeLessThan(roleRank("admin"));
    expect(roleRank("admin")).toBeLessThan(roleRank("admin_manager"));
    expect(roleRank("admin_manager")).toBeLessThan(roleRank("platform_operator"));
    expect(roleRank("staff")).toBe(roleRank("admin_manager"));
  });

  it.each([null, undefined, "", "unknown", "superadmin", "ADMIN", "platform-operator"])("ranks %j as a member", (role) => {
    expect(roleRank(role)).toBe(roleRank("member"));
  });
});

describe("targetOutranksActor", () => {
  it.each([
    ["coach", "admin"],
    ["coach", "admin_manager"],
    ["admin", "admin_manager"],
    ["admin", "staff"],
    ["admin", "platform_operator"],
    ["admin_manager", "platform_operator"],
    ["staff", "platform_operator"],
    ["member", "coach"],
  ])("actor %s vs a %s target: blocked", (actor, target) => {
    expect(targetOutranksActor(r(actor), r(target))).toBe(true);
  });

  it.each([
    ["admin", "member"],
    ["admin", "coach"],
    ["admin", "admin"],
    ["admin_manager", "admin"],
    ["admin_manager", "admin_manager"],
    ["staff", "admin_manager"],
    ["admin_manager", "staff"],
    ["platform_operator", "platform_operator"],
    ["platform_operator", "admin_manager"],
    ["coach", "member"],
  ])("actor %s vs a %s target: not blocked (equal or lower rank)", (actor, target) => {
    expect(targetOutranksActor(r(actor), r(target))).toBe(false);
  });

  it.each([null, undefined, "", "unknown", "superadmin"])("a %j target never outranks anyone", (target) => {
    for (const actor of ["member", "coach", "admin", "admin_manager", "platform_operator", null, undefined, "unknown"]) {
      expect(targetOutranksActor(r(actor), r(target))).toBe(false);
    }
  });

  it.each([null, undefined, "", "unknown", "superadmin"])("a %j actor is outranked by any staff target but not by a member", (actor) => {
    for (const target of ["coach", "admin", "admin_manager", "staff", "platform_operator"]) {
      expect(targetOutranksActor(r(actor), r(target))).toBe(true);
    }
    expect(targetOutranksActor(r(actor), r("member"))).toBe(false);
  });

  it("works when the role key is missing entirely", () => {
    expect(targetOutranksActor({}, {})).toBe(false);
    expect(targetOutranksActor({}, r("admin"))).toBe(true);
    expect(targetOutranksActor(r("admin"), {})).toBe(false);
  });
});
