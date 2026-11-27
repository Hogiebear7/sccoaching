// Fills the "Common" food library from McCance and Widdowson's CoFID 2021 (UK Health Security Agency, Open Government Licence v3.0): every everyday food with calories, protein, carbs, fat,
// fibre, sugar, sodium, saturated fat and the vitamins and minerals we track. Infant formulas and baby foods, alcoholic drinks, and foods with missing or impossible main figures are left out.
// ADDITIVE: never changes or removes a food that is already in the library; a CoFID food whose name is already there is skipped. DRY RUN by default.
//
//   node scripts/seed-common-foods-cofid.mjs --cofid path/to/file.xlsx                          (dry run: prints counts, writes the review sheet, changes nothing)
//   node scripts/seed-common-foods-cofid.mjs --cofid path/to/file.xlsx --confirm                (adds the foods; copies db.json first)
//   add  --report my-review.csv  to choose the review file name.
//
// Set GYM_DB_PATH to target a different datastore file. Takes the datastore lock the way the other operator scripts do (readForScript / writeForScript).
import { randomUUID } from "crypto";
import { copyFileSync, existsSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "node:module";
import readXlsxFile from "read-excel-file/node";

import { buildCommonFood, exclusionReason, readCofidFoods, uniqueNames } from "./lib/cofid-common.mjs";

const { readForScript, writeForScript } = createRequire(import.meta.url)("../lib/datastore/core.js");

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const CONFIRM = args.includes("--confirm");
const COFID_PATH = arg("--cofid");
const REPORT = arg("--report") ?? `cofid-foods-review-${new Date().toISOString().slice(0, 10)}.csv`;
const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));

if (!COFID_PATH || !existsSync(COFID_PATH)) {
  console.error("Give the CoFID spreadsheet with --cofid path/to/file.xlsx");
  process.exit(1);
}
if (!existsSync(DB_PATH)) {
  console.error(`Database not found at ${DB_PATH}.`);
  process.exit(1);
}

let cofid;
try {
  cofid = readCofidFoods(await readXlsxFile(COFID_PATH));
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
console.log(`Read ${cofid.length} CoFID foods.`);

const { db, token } = readForScript(DB_PATH);
const existing = db.commonFoods ?? [];
const existingNames = new Set(existing.map((f) => f.name));
const existingRefs = new Set(existing.map((f) => f.sourceRef).filter(Boolean));

const rows = [];
const keep = [];
const reasons = new Map();
for (const f of cofid) {
  const why = exclusionReason(f) ?? (existingRefs.has(`cofid:${f.code}`) ? "already added from CoFID" : null);
  if (why) {
    reasons.set(why, (reasons.get(why) ?? 0) + 1);
    rows.push([f.code, f.name, "left out", why, f.kcal ?? "", f.proteinG ?? "", f.carbsG ?? "", f.fatG ?? "", Object.keys(f.micros).length]);
  } else keep.push(f);
}
const names = uniqueNames(keep, existingNames);
const toAdd = [];
for (const f of keep) {
  const name = names.get(f.code);
  if (!name) {
    reasons.set("name already in the library", (reasons.get("name already in the library") ?? 0) + 1);
    rows.push([f.code, f.name, "left out", "name already in the library", f.kcal, f.proteinG, f.carbsG, f.fatG, Object.keys(f.micros).length]);
    continue;
  }
  toAdd.push({ food: f, name });
  rows.push([f.code, name, "will add", "", f.kcal, f.proteinG, f.carbsG, f.fatG, Object.keys(f.micros).length]);
}

const withMicros = toAdd.filter((t) => Object.keys(t.food.micros).length > 0).length;
console.log(`\nFoods in the library now: ${existing.length}.`);
console.log(`Will add: ${toAdd.length} (${withMicros} with vitamin and mineral values).`);
console.log(`Left out: ${rows.length - toAdd.length}`);
for (const [why, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${why}`);

const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const header = ["CoFID code", "Food", "Decision", "Reason", "kcal/100g", "Protein", "Carbs", "Fat", "Vitamin and mineral values"];
writeFileSync(REPORT, `﻿${[header, ...rows].map((r) => r.map(cell).join(",")).join("\n")}\n`, "utf8");
console.log(`\nReview sheet written to ${REPORT} (open it in Excel; filter the Decision column).`);

if (!CONFIRM) {
  console.log("\nDRY RUN: nothing was changed. Re-run with --confirm to add the foods marked 'will add'.\n");
  process.exit(0);
}
if (toAdd.length === 0) {
  console.log("\nNothing to add.\n");
  process.exit(0);
}

const backup = `${DB_PATH}.bak-${Date.now()}`;
copyFileSync(DB_PATH, backup);
const now = new Date().toISOString();
db.commonFoods = [...existing, ...toAdd.map(({ food, name }) => ({ id: randomUUID(), ...buildCommonFood(food, name), createdAt: now, updatedAt: now }))];
writeForScript(DB_PATH, db, token);
console.log(`\nAdded ${toAdd.length} common food(s). Copy of the data before the change: ${backup}\n`);
