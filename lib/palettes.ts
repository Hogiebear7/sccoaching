// Preset accent palettes. Each id maps to a `[data-palette="…"]` override
// block in globals.css that re-points the accent tokens; everything else in
// the theme (backgrounds, text, panels) stays identical, so any preset stays
// readable on the dark surface. Members pick one at signup and can change it
// in Settings — there is deliberately no free-form colour input.

export type PaletteId = "electric" | "teal" | "ocean" | "violet" | "ember";

// The member-facing default is the athletic electric-lime accent. Staff
// surfaces don't set data-palette, so they keep the :root teal.
export const DEFAULT_PALETTE: PaletteId = "electric";

export const PALETTE_OPTIONS: {
  id: PaletteId;
  label: string;
  /** Swatch colour for pickers — matches the palette's --accent-primary. */
  swatch: string;
}[] = [
  { id: "electric", label: "Electric", swatch: "oklch(0.86 0.2 128)" },
  { id: "teal",   label: "Club Teal", swatch: "oklch(0.72 0.13 180)" },
  { id: "ocean",  label: "Ocean",     swatch: "oklch(0.68 0.16 250)" },
  { id: "violet", label: "Violet",    swatch: "oklch(0.68 0.19 300)" },
  { id: "ember",  label: "Ember",     swatch: "oklch(0.73 0.15 55)" },
];

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === "string" && PALETTE_OPTIONS.some((p) => p.id === value);
}

// ── Whole-app theme presets ────────────────────────────────────────────
// Separate axis from the accent palette: the theme re-tints the dark base
// (backgrounds, surfaces, atmosphere) via `[data-theme="…"]` blocks in
// globals.css, while the accent keeps colouring actions. Every preset stays
// a dark base at the same lightness steps, so text/contrast are unchanged.

export type ThemeId = "onyx" | "midnight" | "graphite" | "forest" | "plum";

// Near-black athletic base is the member-facing default (pairs with electric).
export const DEFAULT_THEME: ThemeId = "onyx";

export const THEME_OPTIONS: {
  id: ThemeId;
  label: string;
  /** Swatch colour for pickers — matches the theme's base surface. */
  swatch: string;
}[] = [
  { id: "onyx",     label: "Onyx",     swatch: "oklch(0.2 0.006 150)" },
  { id: "midnight", label: "Midnight", swatch: "oklch(0.4 0.07 250)" },
  { id: "graphite", label: "Graphite", swatch: "oklch(0.38 0.008 255)" },
  { id: "forest",   label: "Forest",   swatch: "oklch(0.38 0.05 175)" },
  { id: "plum",     label: "Plum",     swatch: "oklch(0.38 0.06 320)" },
];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_OPTIONS.some((t) => t.id === value);
}
