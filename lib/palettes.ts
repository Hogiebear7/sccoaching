// Preset accent palettes. Each id maps to a `[data-palette="…"]` override
// block in globals.css that re-points the accent tokens; everything else in
// the theme (backgrounds, text, panels) stays identical, so any preset stays
// readable on the dark surface. Members pick one at signup and can change it
// in Settings — there is deliberately no free-form colour input.

export type PaletteId = "teal" | "ocean" | "violet" | "ember";

export const DEFAULT_PALETTE: PaletteId = "teal";

export const PALETTE_OPTIONS: {
  id: PaletteId;
  label: string;
  /** Swatch colour for pickers — matches the palette's --accent-primary. */
  swatch: string;
}[] = [
  { id: "teal",   label: "Club Teal", swatch: "oklch(0.72 0.13 180)" },
  { id: "ocean",  label: "Ocean",     swatch: "oklch(0.68 0.16 250)" },
  { id: "violet", label: "Violet",    swatch: "oklch(0.68 0.19 300)" },
  { id: "ember",  label: "Ember",     swatch: "oklch(0.73 0.15 55)" },
];

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === "string" && PALETTE_OPTIONS.some((p) => p.id === value);
}
