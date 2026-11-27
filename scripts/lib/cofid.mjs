// The pure parts of the CoFID (McCance and Widdowson's Composition of Foods Integrated Dataset, 2021) import: reading a cell, matching a food by name, and deciding how sure the match is.
// No file or datastore access here, so it is unit-tested (__tests__/lib/cofid-import.test.ts). The importer script is scripts/import-cofid-micros.mjs.
//
// Data: UK Health Security Agency / Public Health England, published under the Open Government Licence v3.0. Required credit (shown in the app next to the values):
//   "Contains public sector information licensed under the Open Government Licence v3.0. McCance and Widdowson's The Composition of Foods Integrated Dataset (CoFID), 2021."

export const COFID_CREDIT =
  "Contains public sector information licensed under the Open Government Licence v3.0. McCance and Widdowson's The Composition of Foods Integrated Dataset (CoFID), 2021.";

/** What our nutrient keys are called in each CoFID sheet's column header (the middle header row holds these short codes). */
export const COFID_COLUMNS = {
  "1.4 Inorganics": { ironMg: "FE", calciumMg: "CA", magnesiumMg: "MG", potassiumMg: "K", zincMg: "ZN", iodineUg: "I", seleniumUg: "SE" },
  "1.5 Vitamins": { vitaminAUg: "RETEQU", vitaminCMg: "VITC", vitaminDUg: "VITD", vitaminEMg: "VITE", vitaminKUg: "VITK1", vitaminB12Ug: "VITB12", folateUg: "FOLT" },
  "1.3 Proximates": { omega3G: "TOTn3PFOD" },
};

/**
 * One CoFID cell. Blank and "N" (present in significant amounts but no reliable figure) are UNKNOWN and return undefined, never zero. "Tr" (a trace) is recorded as 0.
 * A figure in brackets (an estimate) is read as that number. Anything unreadable or negative is unknown.
 */
export function parseCofidValue(cell) {
  if (cell === null || cell === undefined) return undefined;
  if (typeof cell === "number") return Number.isFinite(cell) && cell >= 0 ? cell : undefined;
  const text = String(cell).trim();
  if (text === "" || text.toUpperCase() === "N") return undefined;
  if (text.toLowerCase() === "tr") return 0;
  const inner = text.replace(/^\(|\)$/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(inner)) return undefined;
  const n = Number(inner);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const STOP = new Set(["and", "with", "the", "of", "in", "a", "plain", "whole", "fresh", "regular", "average", "type", "style"]);
const COOKED = ["boiled", "roasted", "grilled", "baked", "fried", "steamed", "stewed", "cooked", "braised", "poached", "microwaved", "toasted"];

const stem = (w) => (w.length > 3 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

export function tokens(name) {
  return String(name)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map(stem);
}

/**
 * How well a CoFID food name fits one of our food names, 0 to 1. Every word of ours must be in theirs (with "cooked" met by any cooking word; "raw" by "raw"), otherwise 0.
 * Fewer extra words in theirs scores higher, so "Egg, whole, boiled" beats "Egg, whole, boiled, from hens fed omega-3 enriched feed".
 */
export function nameScore(ourName, cofidName) {
  const ours = tokens(ourName);
  const theirs = new Set(tokens(cofidName));
  if (ours.length === 0 || theirs.size === 0) return 0;
  for (const w of ours) {
    if (w === "cooked") {
      if (!COOKED.some((c) => theirs.has(stem(c)) || theirs.has(c))) return 0;
    } else if (!theirs.has(w)) return 0;
  }
  const extra = theirs.size - ours.length;
  return Math.max(0.1, 1 - Math.max(0, extra) * 0.08);
}

const within = (a, b, relative, absolute) => Math.abs(a - b) <= Math.max(absolute, Math.abs(b) * relative);

/**
 * How sure a match is. "high" needs the name to fit AND the energy and protein to agree with our own figures (a sanity check against matching the wrong food); anything else is "review"
 * for a person to look at, and is never applied by the importer.
 */
export function confidence(ours, cofid, score) {
  if (score < 0.6) return "review";
  const kcalOk = within(ours.calories, cofid.kcal, 0.15, 10);
  const proteinOk = within(ours.proteinG, cofid.proteinG, 0.2, 2);
  return kcalOk && proteinOk ? "high" : "review";
}

/** The best CoFID food for one of ours, or null. Among name matches, the one whose energy and protein are closest wins. */
export function bestMatch(ours, cofidFoods) {
  let best = null;
  for (const c of cofidFoods) {
    const score = nameScore(ours.name, c.name);
    if (score === 0) continue;
    const distance = Math.abs(ours.calories - c.kcal) / Math.max(50, c.kcal) + Math.abs(ours.proteinG - c.proteinG) / Math.max(5, c.proteinG);
    const rank = distance - score * 0.5;
    if (!best || rank < best.rank) best = { food: c, score, rank };
  }
  return best ? { food: best.food, score: best.score, confidence: confidence(ours, best.food, best.score) } : null;
}
