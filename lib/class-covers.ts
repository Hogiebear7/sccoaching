// Curated built-in cover images. Staff can pick one of these ready-made,
// on-brand covers instead of uploading a file. They're plain static SVGs under
// public/class-covers/, so choosing one just stores its PATH in the record's
// `imageUrl` (no data URL, no schema change) and renders through the same
// <img>/ClassImageSlot path as an uploaded cover.
//
// The whitelist below is the security boundary: the server only accepts an
// imageUrl that is either a valid data URL OR one of these known paths, so a
// client can't point imageUrl at an arbitrary URL. Client- and server-safe
// (no server-only imports) — shared by CoverImageField and lib/image-upload.

export type BuiltinCover = {
  /** Stable id — also the file basename. */
  id: string;
  /** Human label shown in the picker. */
  label: string;
  /** Public path stored in `imageUrl`. */
  src: string;
  /** Concise suggested alt text, prefilled (editable) when the cover is picked. */
  defaultAlt: string;
};

export const BUILTIN_COVERS: readonly BuiltinCover[] = [
  { id: "strength", label: "Strength", src: "/class-covers/strength.svg", defaultAlt: "Strength training session" },
  { id: "conditioning", label: "Conditioning", src: "/class-covers/conditioning.svg", defaultAlt: "Conditioning workout" },
  { id: "mobility", label: "Mobility", src: "/class-covers/mobility.svg", defaultAlt: "Mobility and stretching session" },
  { id: "group", label: "Group", src: "/class-covers/group.svg", defaultAlt: "Group fitness class" },
  { id: "endurance", label: "Endurance", src: "/class-covers/endurance.svg", defaultAlt: "Endurance training session" },
  { id: "recovery", label: "Recovery", src: "/class-covers/recovery.svg", defaultAlt: "Recovery session" },
];

const BUILTIN_COVER_SRCS = new Set(BUILTIN_COVERS.map((c) => c.src));
const BUILTIN_DEFAULT_ALTS = new Set(BUILTIN_COVERS.map((c) => c.defaultAlt));

/** True when `value` is one of the known built-in cover paths. */
export function isBuiltinCoverSrc(value: string): boolean {
  return BUILTIN_COVER_SRCS.has(value);
}

/** True when `value` is (still) one of the auto-suggested built-in alt texts —
    i.e. a suggestion staff hasn't customised. */
export function isBuiltinDefaultAlt(value: string): boolean {
  return BUILTIN_DEFAULT_ALTS.has(value.trim());
}

// Decides the alt text after a built-in cover is picked: prefill the cover's
// concise default, but never clobber custom text staff already typed. An empty
// field (including one intentionally cleared) or a field still holding a prior
// suggestion is safe to (re)fill; anything else is treated as custom and kept.
export function suggestAltForCover(currentAlt: string, cover: BuiltinCover): string {
  return currentAlt.trim() === "" || isBuiltinDefaultAlt(currentAlt)
    ? cover.defaultAlt
    : currentAlt;
}

function coverById(id: string): BuiltinCover {
  return BUILTIN_COVERS.find((c) => c.id === id) ?? BUILTIN_COVERS[0];
}

// Maps a class category to the most fitting built-in cover by keyword. Checked
// in priority order; the first cover whose keywords appear in the category
// slug/name wins. "group" is the neutral fallback for generic class formats.
const CATEGORY_COVER_KEYWORDS: readonly { id: string; keywords: readonly string[] }[] = [
  { id: "strength", keywords: ["strength", "lift", "power", "weight", "barbell"] },
  { id: "endurance", keywords: ["endurance", "run", "row", "cycle", "spin", "engine", "triathlon"] },
  { id: "conditioning", keywords: ["condition", "cardio", "hiit", "metcon", "circuit", "bootcamp", "interval"] },
  { id: "mobility", keywords: ["mobility", "stretch", "yoga", "pilates", "flex"] },
  { id: "recovery", keywords: ["recovery", "restore", "rehab", "regen", "cool"] },
  { id: "group", keywords: ["group", "class", "semi", "parent", "baby", "mother", "kids", "community", "general"] },
];

/** Suggests the built-in cover that best fits a class category (by slug/name
    keyword). Always returns a cover — falls back to the generic "group" one. */
export function suggestCoverForCategory(slug: string, name = ""): BuiltinCover {
  const hay = `${slug} ${name}`.toLowerCase();
  for (const entry of CATEGORY_COVER_KEYWORDS) {
    if (entry.keywords.some((k) => hay.includes(k))) return coverById(entry.id);
  }
  return coverById("group");
}
