import { describe, expect, it } from "vitest";

import { logoBackgroundColour, resolveBranding, validateBranding } from "@/lib/gym-branding";

describe("logo background", () => {
  it("is the app's navy by default, white for light, and a gym's own colour as given", () => {
    expect(logoBackgroundColour(undefined)).toBe("#0A1526");
    expect(logoBackgroundColour("dark")).toBe("#0A1526");
    expect(logoBackgroundColour("light")).toBe("#FFFFFF");
    expect(logoBackgroundColour("#00aa44")).toBe("#00AA44");
    expect(logoBackgroundColour("purple")).toBe("#0A1526");
    expect(resolveBranding({ name: "G", branding: { accentColor: null, logoUrl: "https://x.test/a.png" } }).logoBackground).toBe("#0A1526");
    expect(resolveBranding({ name: "G", branding: { accentColor: null, logoUrl: null, logoBackground: "light" } }).logoBackground).toBe("#FFFFFF");
    expect(resolveBranding({ name: "G", branding: { accentColor: null, logoUrl: null, logoBackground: "#000000" } }).logoBackground).toBe("#000000");
  });
  it("accepts light, dark, null or a colour; rejects anything else", () => {
    expect(validateBranding({ logoBackground: "light" }, { accentColor: "#4DA3FF", logoUrl: null })).toMatchObject({ ok: true, branding: { logoBackground: "light", accentColor: "#4DA3FF" } });
    expect(validateBranding({ logoBackground: "#00aa44" }, undefined)).toMatchObject({ ok: true, branding: { logoBackground: "#00AA44" } });
    expect(validateBranding({ logoBackground: null }, { accentColor: null, logoUrl: null, logoBackground: "light" })).toMatchObject({ ok: true, branding: { logoBackground: null } });
    for (const bad of ["purple", "#12", "javascript:1", 5]) expect(validateBranding({ logoBackground: bad }, undefined)).toMatchObject({ ok: false });
  });
  it("is kept when only the accent colour changes", () => {
    expect(validateBranding({ accentColor: "#4DA3FF" }, { accentColor: null, logoUrl: null, logoBackground: "#000000" })).toMatchObject({ ok: true, branding: { logoBackground: "#000000" } });
  });
});
