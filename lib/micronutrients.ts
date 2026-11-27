// Vitamins, minerals and omega-3 (phase 2 of the nutrition work; plan-micronutrients-and-water-phase2-2026-11-24.md). The tracked list is fifteen nutrients. The rules that matter:
//
//   * UNKNOWN IS NEVER ZERO. A food either lists a nutrient or it does not. An entry with no value for iron says nothing about iron, so a day's iron total counts only the foods that
//     list it and reports how many did not, so the app can say "at least" and show how complete the data is. (Same rule as fibre, sugar, sodium and saturated fat.)
//   * Values are per 100 g on a food and per entry on a diary entry or favourite, in the unit shown in MICRONUTRIENTS (mg, µg or g). Nothing is converted between units elsewhere.
//   * AI-estimated foods (photos, typed descriptions, meal ideas) carry NO micronutrients: the AI cannot do this reliably. They count as "not listed".
//
// Pure: no datastore access, so every rule here is unit-tested.
export type MicroKey =
  | "ironMg" | "calciumMg" | "magnesiumMg" | "potassiumMg" | "zincMg" | "iodineUg" | "seleniumUg"
  | "vitaminAUg" | "vitaminCMg" | "vitaminDUg" | "vitaminEMg" | "vitaminKUg" | "vitaminB12Ug" | "folateUg"
  | "omega3G";

export type MicroUnit = "mg" | "µg" | "g";
export type MicroGroup = "mineral" | "vitamin" | "fat";

export interface MicroDef {
  key: MicroKey;
  label: string;
  unit: MicroUnit;
  group: MicroGroup;
  /** Decimal places kept when a value is stored or added up. */
  decimals: number;
  /** The most one entry (or 100 g of one food) can plausibly hold; anything above is rejected as a typing or import error. */
  max: number;
}

export const MICRONUTRIENTS: readonly MicroDef[] = [
  { key: "ironMg", label: "Iron", unit: "mg", group: "mineral", decimals: 2, max: 500 },
  { key: "calciumMg", label: "Calcium", unit: "mg", group: "mineral", decimals: 0, max: 20000 },
  { key: "magnesiumMg", label: "Magnesium", unit: "mg", group: "mineral", decimals: 0, max: 5000 },
  { key: "potassiumMg", label: "Potassium", unit: "mg", group: "mineral", decimals: 0, max: 20000 },
  { key: "zincMg", label: "Zinc", unit: "mg", group: "mineral", decimals: 2, max: 500 },
  { key: "iodineUg", label: "Iodine", unit: "µg", group: "mineral", decimals: 0, max: 20000 },
  { key: "seleniumUg", label: "Selenium", unit: "µg", group: "mineral", decimals: 1, max: 5000 },
  { key: "vitaminAUg", label: "Vitamin A", unit: "µg", group: "vitamin", decimals: 0, max: 100000 },
  { key: "vitaminCMg", label: "Vitamin C", unit: "mg", group: "vitamin", decimals: 1, max: 5000 },
  { key: "vitaminDUg", label: "Vitamin D", unit: "µg", group: "vitamin", decimals: 1, max: 5000 },
  { key: "vitaminEMg", label: "Vitamin E", unit: "mg", group: "vitamin", decimals: 1, max: 1000 },
  { key: "vitaminKUg", label: "Vitamin K", unit: "µg", group: "vitamin", decimals: 1, max: 10000 },
  { key: "vitaminB12Ug", label: "Vitamin B12", unit: "µg", group: "vitamin", decimals: 2, max: 5000 },
  { key: "folateUg", label: "Folate", unit: "µg", group: "vitamin", decimals: 0, max: 20000 },
  { key: "omega3G", label: "Omega-3", unit: "g", group: "fat", decimals: 2, max: 200 },
];

export const MICRO_KEYS: readonly MicroKey[] = MICRONUTRIENTS.map((d) => d.key);
const DEF_BY_KEY = new Map<MicroKey, MicroDef>(MICRONUTRIENTS.map((d) => [d.key, d]));
export const microDef = (key: MicroKey): MicroDef => DEF_BY_KEY.get(key)!;

/** The nutrients a food or entry lists. A key is present only when the value is known. */
export type MicroMap = Partial<Record<MicroKey, number>>;

const roundTo = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

/** Reads a MicroMap from untrusted input: only known keys, only finite numbers from 0 up to the key's limit; anything else is left out (never turned into zero). */
export function parseMicros(raw: unknown): MicroMap {
  const out: MicroMap = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const def of MICRONUTRIENTS) {
    const v = (raw as Record<string, unknown>)[def.key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= def.max) out[def.key] = roundTo(v, def.decimals);
  }
  return out;
}

/** Water in grams (per 100 g on a food, per entry on a diary entry): a number from 0 to 100 per 100 g's worth, or null when not known. */
export function parseWaterG(raw: unknown, max = 100000): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= max ? Math.round(raw * 10) / 10 : null;
}

/** A food's per-100 g micronutrients scaled to an amount (factor = grams / 100). Unknown stays unknown. */
export function scaleMicros(per100: MicroMap | null | undefined, factor: number): MicroMap {
  const out: MicroMap = {};
  if (!per100 || !Number.isFinite(factor) || factor < 0) return out;
  for (const def of MICRONUTRIENTS) {
    const v = per100[def.key];
    if (typeof v === "number" && Number.isFinite(v)) out[def.key] = roundTo(v * factor, def.decimals);
  }
  return out;
}

export function hasAnyMicros(map: MicroMap | null | undefined): boolean {
  return !!map && MICRO_KEYS.some((k) => typeof map[k] === "number");
}

export interface MicroTotal {
  key: MicroKey;
  /** The sum over the entries that list this nutrient. Zero with listedBy 0 means "no data", not "none eaten". */
  total: number;
  /** How many entries list it. */
  listedBy: number;
  /** How many entries there were in all. */
  entryCount: number;
  /** True when some entries do not list it, so the total is a minimum. */
  atLeast: boolean;
}

/** Adds up a day's (or any period's) entries per nutrient, counting only entries that list it. The coverage is listedBy out of entryCount. */
export function sumMicros(entries: readonly { micros?: MicroMap | null }[]): MicroTotal[] {
  return MICRONUTRIENTS.map((def) => {
    let total = 0;
    let listedBy = 0;
    for (const e of entries) {
      const v = e.micros?.[def.key];
      if (typeof v === "number") {
        total += v;
        listedBy += 1;
      }
    }
    return { key: def.key, total: roundTo(total, def.decimals), listedBy, entryCount: entries.length, atLeast: listedBy < entries.length };
  });
}

/** "8 of 11 foods list this" for the small coverage line under a nutrient. */
export function coverageText(t: Pick<MicroTotal, "listedBy" | "entryCount">): string {
  if (t.entryCount === 0) return "No foods logged yet";
  if (t.listedBy === 0) return `None of ${t.entryCount} food${t.entryCount === 1 ? "" : "s"} list this`;
  if (t.listedBy === t.entryCount) return t.entryCount === 1 ? "The food you logged lists this" : `All ${t.entryCount} foods list this`;
  return `${t.listedBy} of ${t.entryCount} foods list this`;
}

/** The amount for display: "12.5 mg", with "at least" in front when the total is a minimum and some data exists. */
export function formatMicro(t: MicroTotal): string {
  const def = microDef(t.key);
  if (t.listedBy === 0) return "No data";
  const value = def.decimals === 0 ? String(Math.round(t.total)) : String(roundTo(t.total, def.decimals));
  return `${t.atLeast ? "at least " : ""}${value} ${def.unit}`;
}
