// Turns the CoFID spreadsheet (McCance and Widdowson, 2021) into "Common" foods for the food library: every everyday food with its energy, protein, carbs, fat and the vitamins and minerals we track.
// Pure functions only (no files, no datastore), so they are unit-tested (__tests__/lib/cofid-common.test.ts). The script that uses them is scripts/seed-common-foods-cofid.mjs.
//
// Data: UK Health Security Agency / Public Health England, Open Government Licence v3.0 (credit in scripts/lib/cofid.mjs).
import { COFID_COLUMNS, parseCofidValue } from "./cofid.mjs";

const INFANT = /\b(infant|baby|babies|follow-on|follow on|formula|weaning|toddler)\b/i;
const INFANT_GROUPS = /^(BF|AK)/;

/** Which sheet column (by its short code in the second header row) each extra figure comes from. */
const PROXIMATE_FIELDS = { kcal: "KCALS", proteinG: "PROT", fatG: "FAT", carbsG: "CHO", sugarG: "TOTSUG", fiberG: "AOACFIB", saturatedFatG: "SATFOD", waterG: "WATER", alcoholG: "ALCO" };
const SODIUM = ["1.4 Inorganics", "NA"];

const colIndex = (rows, short) => rows[1].findIndex((c) => String(c ?? "").trim() === short);

/**
 * Reads every CoFID food from the workbook's sheets ([{ sheet, data }]). Returns an array of
 * { code, name, group, kcal, proteinG, carbsG, fatG, sugarG, fiberG, saturatedFatG, waterG, alcoholG, sodiumMg, micros }.
 * A figure CoFID does not give (blank or "N") is undefined, never zero; a trace ("Tr") is 0.
 */
export function readCofidFoods(sheets) {
  const sheet = (name) => sheets.find((s) => s.sheet === name)?.data;
  const prox = sheet("1.3 Proximates");
  if (!prox) throw new Error("This does not look like the CoFID spreadsheet (no '1.3 Proximates' sheet).");
  const foods = new Map();
  const ensure = (row) => {
    const code = String(row[0]);
    if (!foods.has(code)) foods.set(code, { code, name: String(row[1] ?? "").trim(), group: String(row[3] ?? "").trim(), micros: {} });
    return foods.get(code);
  };
  const proxCols = Object.entries(PROXIMATE_FIELDS).map(([key, short]) => [key, colIndex(prox, short)]);
  for (const [key, idx] of proxCols) if (idx < 0 && key !== "alcoholG") throw new Error(`Proximates sheet has no ${PROXIMATE_FIELDS[key]} column.`);
  for (const row of prox.slice(3)) {
    if (!row[0]) continue;
    const f = ensure(row);
    for (const [key, idx] of proxCols) if (idx >= 0) f[key] = parseCofidValue(row[idx]);
  }
  for (const [sheetName, map] of Object.entries(COFID_COLUMNS)) {
    const rows = sheet(sheetName);
    if (!rows) throw new Error(`Missing sheet ${sheetName}.`);
    const cols = Object.entries(map).map(([key, short]) => [key, colIndex(rows, short)]);
    for (const [key, idx] of cols) if (idx < 0) throw new Error(`Sheet ${sheetName} has no column ${map[key]} for ${key}.`);
    for (const row of rows.slice(3)) {
      if (!row[0]) continue;
      const f = ensure(row);
      for (const [key, idx] of cols) {
        const v = parseCofidValue(row[idx]);
        if (v !== undefined) f.micros[key] = v;
      }
    }
  }
  const inorganics = sheet(SODIUM[0]);
  const naIdx = inorganics ? colIndex(inorganics, SODIUM[1]) : -1;
  if (naIdx >= 0) {
    for (const row of inorganics.slice(3)) {
      if (!row[0]) continue;
      ensure(row).sodiumMg = parseCofidValue(row[naIdx]);
    }
  }
  return [...foods.values()];
}

/**
 * Why a CoFID food is NOT added as a common food, or null when it is fine to add. The library is for everyday foods people weigh and log, so infant formulas and baby foods,
 * alcoholic drinks (listed per 100 ml, not per 100 g; recognised by their CoFID group) and foods with missing or impossible main figures are left out. Everything left out is listed in the review sheet with its reason.
 */
export function exclusionReason(food) {
  if (!food.name) return "no name";
  if (INFANT.test(food.name) || INFANT_GROUPS.test(food.group)) return "infant food or formula";
  // Drinks are the CoFID groups starting with Q (beer, cider, wine, spirits, liqueurs); a food cooked with a little wine or rum (a cake, a casserole) is still a food.
  if (/^Q/.test(food.group) || /^coffee, irish/i.test(food.name)) return "alcoholic drink (listed per 100 ml)";
  const { kcal, proteinG, carbsG, fatG } = food;
  for (const v of [kcal, proteinG, carbsG, fatG]) if (typeof v !== "number" || !Number.isFinite(v)) return "missing energy, protein, carbohydrate or fat figure";
  if (kcal > 950) return "energy figure not plausible";
  if (proteinG + carbsG + fatG > 105) return "figures do not add up";
  return null;
}

/** The names to use: CoFID's own name, made unique among the list (a repeat gets its description or code in brackets) and different from names already in the library. */
export function uniqueNames(foods, existingNames = new Set()) {
  const taken = new Set([...existingNames].map((n) => n.trim().toLowerCase()));
  const out = new Map();
  for (const f of foods) {
    let name = f.name;
    if (taken.has(name.toLowerCase())) name = `${f.name} (${f.code})`;
    if (taken.has(name.toLowerCase())) continue;
    taken.add(name.toLowerCase());
    out.set(f.code, name);
  }
  return out;
}

/** The food record to store (without id and dates, which the script adds). Only figures CoFID gives are set; unknown stays null / absent. */
export function buildCommonFood(food, name) {
  const micros = { ...food.micros };
  const nutrition100g = {
    calories: food.kcal,
    proteinG: food.proteinG,
    carbsG: food.carbsG,
    fatG: food.fatG,
    fiberG: food.fiberG ?? null,
    sugarG: food.sugarG ?? null,
    sodiumMg: food.sodiumMg ?? null,
    saturatedFatG: food.saturatedFatG ?? null,
    waterG: food.waterG ?? null,
    ...(Object.keys(micros).length > 0 ? { micros } : {}),
  };
  const hundredGram = { label: "100g", grams: 100 };
  return {
    domain: "common",
    name,
    brandName: null,
    barcode: null,
    imageUrl: null,
    nutrition100g,
    microsSource: Object.keys(micros).length > 0 ? `CoFID 2021, food ${food.code}` : null,
    defaultServing: hundredGram,
    servings: [hundredGram],
    provenance: "cofid",
    sourceRef: `cofid:${food.code}`,
    verified: true,
    region: null,
    ownerUserId: null,
    archivedAt: null,
    fetchedAt: null,
  };
}
