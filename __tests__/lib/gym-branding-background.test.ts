import { describe, expect, it } from "vitest";

import { resolveBranding, validateBranding } from "@/lib/gym-branding";

describe("logo background", () => {
  it("defaults to dark, accepts light, dark or null, and rejects anything else", () => {
    expect(resolveBranding({ name: "G", branding: { accentColor: null, logoUrl: "https://x.test/a.png" } }).logoBackground).toBe("dark");
    expect(resolveBranding({ name: "G", branding: { accentColor: null, logoUrl: null, logoBackground: "light" } }).logoBackground).toBe("light");
    expect(validateBranding({ logoBackground: "light" }, { accentColor: "#4DA3FF", logoUrl: null })).toMatchObject({ ok: true, branding: { logoBackground: "light", accentColor: "#4DA3FF" } });
    expect(validateBranding({ logoBackground: null }, { accentColor: null, logoUrl: null, logoBackground: "light" })).toMatchObject({ ok: true, branding: { logoBackground: null } });
    expect(validateBranding({ logoBackground: "purple" }, undefined)).toMatchObject({ ok: false });
  });
  it("is kept when only the colour changes", () => {
    expect(validateBranding({ accentColor: "#4DA3FF" }, { accentColor: null, logoUrl: null, logoBackground: "light" })).toMatchObject({ ok: true, branding: { logoBackground: "light" } });
  });
});
