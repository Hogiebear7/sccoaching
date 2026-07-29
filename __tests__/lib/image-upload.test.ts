import { describe, expect, it } from "vitest";

import {
  MAX_COVER_ALT_LENGTH,
  isValidImageDataUrl,
  resolveCoverAltInput,
  resolveCoverImageInput,
} from "@/lib/image-upload";
import {
  BUILTIN_COVERS,
  isBuiltinCoverSrc,
  isBuiltinDefaultAlt,
  suggestAltForCover,
  suggestCoverForCategory,
} from "@/lib/class-covers";

const DATA_URL = "data:image/jpeg;base64,AAAA=";

describe("resolveCoverImageInput", () => {
  it("leaves the value unchanged when undefined (edit = keep existing)", () => {
    expect(resolveCoverImageInput(undefined)).toEqual({ ok: true, value: undefined });
  });

  it("removes the cover when null", () => {
    expect(resolveCoverImageInput(null)).toEqual({ ok: true, value: null });
  });

  it("accepts a valid uploaded data URL", () => {
    expect(resolveCoverImageInput(DATA_URL)).toEqual({ ok: true, value: DATA_URL });
  });

  it("accepts a known built-in cover path", () => {
    const src = BUILTIN_COVERS[0].src;
    expect(isBuiltinCoverSrc(src)).toBe(true);
    expect(resolveCoverImageInput(src)).toEqual({ ok: true, value: src });
  });

  it("rejects a non-whitelisted path (no arbitrary URLs)", () => {
    expect(resolveCoverImageInput("/class-covers/evil.svg")).toEqual({ ok: false });
    expect(resolveCoverImageInput("https://example.com/x.png")).toEqual({ ok: false });
    expect(resolveCoverImageInput("/etc/passwd")).toEqual({ ok: false });
  });

  it("rejects an over-long data URL", () => {
    const big = "data:image/png;base64," + "A".repeat(600_000);
    expect(isValidImageDataUrl(big)).toBe(false);
    expect(resolveCoverImageInput(big)).toEqual({ ok: false });
  });
});

describe("resolveCoverAltInput", () => {
  it("keeps existing alt when undefined", () => {
    expect(resolveCoverAltInput(undefined)).toEqual({ ok: true, value: undefined });
  });

  it("treats null and blank/whitespace as decorative (null)", () => {
    expect(resolveCoverAltInput(null)).toEqual({ ok: true, value: null });
    expect(resolveCoverAltInput("")).toEqual({ ok: true, value: null });
    expect(resolveCoverAltInput("   ")).toEqual({ ok: true, value: null });
  });

  it("trims and stores a meaningful description", () => {
    expect(resolveCoverAltInput("  Coach leading a squat  ")).toEqual({
      ok: true,
      value: "Coach leading a squat",
    });
  });

  it("rejects an over-long description", () => {
    expect(resolveCoverAltInput("a".repeat(MAX_COVER_ALT_LENGTH + 1))).toEqual({ ok: false });
  });
});

describe("suggestAltForCover (built-in default alt prefill)", () => {
  const strength = BUILTIN_COVERS.find((c) => c.id === "strength")!;
  const recovery = BUILTIN_COVERS.find((c) => c.id === "recovery")!;

  it("marks each cover's default alt as a suggestion (not custom)", () => {
    expect(isBuiltinDefaultAlt(strength.defaultAlt)).toBe(true);
    expect(isBuiltinDefaultAlt("  " + recovery.defaultAlt + "  ")).toBe(true);
    expect(isBuiltinDefaultAlt("Coach Sarah's HIIT")).toBe(false);
  });

  it("prefills the default alt when the field is empty", () => {
    expect(suggestAltForCover("", strength)).toBe(strength.defaultAlt);
    expect(suggestAltForCover("   ", strength)).toBe(strength.defaultAlt);
  });

  it("updates the suggestion when switching between built-in covers", () => {
    // Field still holds strength's suggestion → picking recovery replaces it.
    expect(suggestAltForCover(strength.defaultAlt, recovery)).toBe(recovery.defaultAlt);
  });

  it("never overwrites custom alt text staff typed", () => {
    expect(suggestAltForCover("Coach Sarah's HIIT", recovery)).toBe("Coach Sarah's HIIT");
  });
});

describe("suggestCoverForCategory (category-aware default cover)", () => {
  it("maps common class categories to a fitting cover", () => {
    expect(suggestCoverForCategory("strength").id).toBe("strength");
    expect(suggestCoverForCategory("cardio").id).toBe("conditioning");
    expect(suggestCoverForCategory("mother_and_baby").id).toBe("group");
    expect(suggestCoverForCategory("parent_and_baby").id).toBe("group");
    expect(suggestCoverForCategory("semi_private_pt").id).toBe("group");
    expect(suggestCoverForCategory("general").id).toBe("group");
  });

  it("matches on the human name when the slug is opaque", () => {
    expect(suggestCoverForCategory("cat_x", "Yoga Flow").id).toBe("mobility");
    expect(suggestCoverForCategory("cat_y", "Endurance Engine").id).toBe("endurance");
  });

  it("falls back to the neutral group cover for unknown categories", () => {
    expect(suggestCoverForCategory("quantum_basketweaving").id).toBe("group");
  });

  it("always returns a cover carrying a default alt", () => {
    const cover = suggestCoverForCategory("strength");
    expect(cover.src).toMatch(/^\/class-covers\//);
    expect(cover.defaultAlt.length).toBeGreaterThan(0);
  });
});
