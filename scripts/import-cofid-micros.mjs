// Adds vitamin and mineral values to the "Common" foods from McCance and Widdowson's CoFID 2021 (UK Health Security Agency, Open Government Licence v3.0).
// ADDITIVE and CAREFUL: only fills nutrients a common food does not have yet, never changes what is already there, and only applies matches that are HIGH confidence (the name fits and
// the energy and protein agree with our own figures). Everything else is written to a review CSV for a person to look at. DRY RUN by default.
//
//   node scripts/import-cofid-micros.mjs --cofid path/to/McCance_Widdowsons_..._2021..xlsx                     (dry run: prints and writes the review CSV, changes nothing)
//   node scripts/import-cofid-micros.mjs --cofid path/to/file.xlsx --confirm                                    (applies the high-confidence matches; backs up db.json first)
//   add  --report my-review.csv  to choose the review file name.
//
// Set GYM_DB_PATH to target a different datastore file. The importer takes the datastore lock the way the other operator scripts do (readForScript / writeForScript).
import { copyFileSync, existsSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "node:module";
import readXlsxFile from "read-excel-file/node";

import { bestMatch, COFID_COLUMNS, COFID_CREDIT, parseCofidValue } from "./lib/cofid.mjs";

const { readForScript, writeForScript } = createRequire(import.meta.url)("../lib/datastore/core.js");

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const CONFIRM = args.includes("--confirm");
const COFID_PATH = arg("--cofid");
const REPORT = arg("--report") ?? `cofid-review-${new Date().toISOString().slice(0, 10)}.csv`;
const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));

if (!COFID_PATH || !existsSync(COFID_PATH)) {
  console.error("Give the CoFID spreadsheet with --cofid path/to/file.xlsx");
  process.exit(1);
}
if (!existsSync(DB_PATH)) {
  console.error(`Database not found at ${DB_PATH}.`);
  process.exit(1);
}

// 1. Read CoFID: every food with its energy, protein and the nutrients we track.
const sheets = await readXlsxFile(COFID_PATH);
const sheet = (name) => sheets.find((s) => s.sheet === name)?.data;
const foods = new Map();
const ensure = (code, name) => {
  if (!foods.has(code)) foods.set(code, { code, name: String(name ?? ""), kcal: NaN, proteinG: NaN, micros: {} });
  return foods.get(code);
};
const proximates = sheet("1.3 Proximates");
if (!proximates) {
  console.error("This does not look like the CoFID spreadsheet (no '1.3 Proximates' sheet).");
  process.exit(1);
}
const colIndex = (rows, short) => rows[1].findIndex((c) => String(c ?? "").trim() === short);
{
  const kcalCol = colIndex(proximates, "KCALS");
  const protCol = colIndex(proximates, "PROT");
  for (const row of proximates.slice(3)) {
    if (!row[0]) continue;
    const f = ensure(String(row[0]), row[1]);
    f.kcal = parseCofidValue(row[kcalCol]) ?? NaN;
    f.proteinG = parseCofidValue(row[protCol]) ?? NaN;
  }
}
for (const [sheetName, map] of Object.entries(COFID_COLUMNS)) {
  const rows = sheet(sheetName);
  if (!rows) {
    console.error(`Missing sheet ${sheetName}.`);
    process.exit(1);
  }
  const cols = Object.entries(map).map(([key, short]) => [key, colIndex(rows, short)]);
  for (const [key, idx] of cols) if (idx < 0) {
    console.error(`Sheet ${sheetName} has no column ${map[key]} for ${key}.`);
    process.exit(1);
  }
  for (const row of rows.slice(3)) {
    if (!row[0]) continue;
    const f = ensure(String(row[0]), row[1]);
    for (const [key, idx] of cols) {
      const v = parseCofidValue(row[idx]);
      if (v !== undefined) f.micros[key] = v;
    }
  }
}
const cofidFoods = [...foods.values()].filter((f) => Number.isFinite(f.kcal) && Number.isFinite(f.proteinG));
console.log(`Read ${cofidFoods.length} CoFID foods.`);

// 2. Our common foods and the best CoFID match for each.
const { db, token } = readForScript(DB_PATH);
const common = db.commonFoods ?? [];
const results = common.map((food) => {
  const n = food.nutrition100g ?? {};
  const ours = { name: food.name, calories: Number(n.calories) || 0, proteinG: Number(n.proteinG) || 0 };
  const match = bestMatch(ours, cofidFoods);
  const have = Object.keys(n.micros ?? {}).length;
  const fill = match ? Object.keys(match.food.micros).filter((k) => !(n.micros && k in n.micros)) : [];
  return { food, ours, match, have, fill };
});

const high = results.filter((r) => r.match?.confidence === "high" && r.fill.length > 0);
const review = results.filter((r) => r.match && r.match.confidence !== "high");
const none = results.filter((r) => !r.match);
console.log(`\nCommon foods: ${common.length}. Will fill: ${high.length}. Need a person to look: ${review.length}. No match: ${none.length}. Already complete: ${results.filter((r) => r.match?.confidence === "high" && r.fill.length === 0).length}.\n`);
for (const r of high) console.log(`  + ${r.food.name}  <-  ${r.match.food.code} ${r.match.food.name}  (+${r.fill.length} nutrients)`);

const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csvRows = [["Our food", "Our kcal", "Our protein", "CoFID code", "CoFID food", "CoFID kcal", "CoFID protein", "Confidence", "Nutrients it would add"]];
for (const r of results) {
  csvRows.push([r.food.name, r.ours.calories, r.ours.proteinG, r.match?.food.code ?? "", r.match?.food.name ?? "", r.match?.food.kcal ?? "", r.match?.food.proteinG ?? "", r.match?.confidence ?? "no match", r.fill.join(" ")]);
}
writeFileSync(REPORT, `﻿${csvRows.map((r) => r.map(cell).join(",")).join("\n")}\n`, "utf8");
console.log(`\nReview sheet written to ${REPORT} (open it in Excel; everything not applied is listed with its best guess).`);

if (!CONFIRM) {
  console.log("\nDRY RUN: nothing was changed. Re-run with --confirm to apply the high-confidence matches above.\n");
  process.exit(0);
}
if (high.length === 0) {
  console.log("\nNothing to apply.\n");
  process.exit(0);
}

const backup = `${DB_PATH}.bak-${Date.now()}`;
copyFileSync(DB_PATH, backup);
for (const r of high) {
  const food = db.commonFoods.find((f) => f.id === r.food.id);
  if (!food) continue;
  food.nutrition100g = food.nutrition100g ?? {};
  const merged = { ...(food.nutrition100g.micros ?? {}) };
  for (const key of r.fill) merged[key] = r.match.food.micros[key];
  food.nutrition100g.micros = merged;
  food.microsSource = `CoFID 2021, food ${r.match.food.code}`;
}
writeForScript(DB_PATH, db, token);
console.log(`\nApplied to ${high.length} foods. Backup: ${backup}\nCredit to show in the app: ${COFID_CREDIT}\n`);
