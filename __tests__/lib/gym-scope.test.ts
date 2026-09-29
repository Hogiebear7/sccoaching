import { describe, expect, it } from "vitest";

import { catalogScopesMatch, sameGym } from "@/lib/gym-scope";

describe("sameGym", () => {
  it("treats two accounts with no gymId as the same (primary) gym", () => {
    expect(sameGym({}, {})).toBe(true);
    expect(sameGym({ gymId: null }, { gymId: undefined })).toBe(true);
  });

  it("treats a real gymId as different from the primary gym", () => {
    expect(sameGym({ gymId: "gym-2" }, {})).toBe(false);
    expect(sameGym({}, { gymId: "gym-2" })).toBe(false);
  });

  it("treats two accounts with matching real gymIds as the same gym", () => {
    expect(sameGym({ gymId: "gym-2" }, { gymId: "gym-2" })).toBe(true);
  });

  it("treats two accounts with different real gymIds as different gyms", () => {
    expect(sameGym({ gymId: "gym-2" }, { gymId: "gym-3" })).toBe(false);
  });
});

describe("catalogScopesMatch", () => {
  it("matches two platform scopes", () => {
    expect(catalogScopesMatch({ scope: "platform" }, { scope: "platform" })).toBe(true);
  });

  it("matches two gym scopes with the same gymId, including two nulls (primary gym)", () => {
    expect(catalogScopesMatch({ scope: "gym", gymId: "gym-a" }, { scope: "gym", gymId: "gym-a" })).toBe(true);
    expect(catalogScopesMatch({ scope: "gym", gymId: null }, { scope: "gym", gymId: null })).toBe(true);
  });

  it("does not match two gym scopes with different gymIds", () => {
    expect(catalogScopesMatch({ scope: "gym", gymId: "gym-a" }, { scope: "gym", gymId: "gym-b" })).toBe(false);
  });

  it("does not match a gym scope against a platform scope, in either direction", () => {
    expect(catalogScopesMatch({ scope: "gym", gymId: "gym-a" }, { scope: "platform" })).toBe(false);
    expect(catalogScopesMatch({ scope: "platform" }, { scope: "gym", gymId: "gym-a" })).toBe(false);
  });

  it("never matches when either side is unresolved, even both sides", () => {
    expect(catalogScopesMatch({ scope: "unresolved" }, { scope: "platform" })).toBe(false);
    expect(catalogScopesMatch({ scope: "gym", gymId: "gym-a" }, { scope: "unresolved" })).toBe(false);
    expect(catalogScopesMatch({ scope: "unresolved" }, { scope: "unresolved" })).toBe(false);
  });
});
