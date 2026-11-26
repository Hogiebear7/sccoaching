// READ-ONLY coverage report for vitamins and minerals (micronutrients step 2). Says how complete the data is, so we know how much to trust the totals before any screen shows them.
// Reads the datastore once; writes nothing; takes no lock; prints counts and percentages only (no names, no emails).
//
//   node scripts/micronutrient-coverage.mjs                 (uses GYM_DB_PATH, else data/db.json beside the app)
//
// For each of the fifteen nutrients: how many common foods, branded foods and diary entries list it, and the share. "Lists it" means the value is present (a real 0 counts; a missing key
// is "not known" and is never treated as zero). The list below must match MICRONUTRIENTS in lib/micronutrients.ts (a test checks that).
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";

const KEYS = [
  ["ironMg", "Iron"], ["calciumMg", "Calcium"], ["magnesiumMg", "Magnesium"], ["potassiumMg", "Potassium"], ["zincMg", "Zinc"], ["iodineUg", "Iodine"], ["seleniumUg", "Selenium"],
  ["vitaminAUg", "Vitamin A"], ["vitaminCMg", "Vitamin C"], ["vitaminDUg", "Vitamin D"], ["vitaminEMg", "Vitamin E"], ["vitaminKUg", "Vitamin K"], ["vitaminB12Ug", "Vitamin B12"],
  ["folateUg", "Folate"], ["omega3G", "Omega-3"],
];
const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));
if (!existsSync(DB_PATH)) {
  console.error(`Database not found at ${DB_PATH}.`);
  process.exit(1);
}
const db = JSON.parse(readFileSync(DB_PATH, "utf8"));
const common = db.commonFoods ?? [];
const branded = db.brandedFoods ?? [];
const entries = db.foodEntries ?? [];
const pct = (n, d) => (d === 0 ? "  n/a" : `${String(Math.round((n / d) * 100)).padStart(3)}%`);
const lists = (micros, key) => micros && typeof micros[key] === "number";

console.log(`Micronutrient coverage  (${DB_PATH})`);
console.log(`Common foods: ${common.length}   Branded foods: ${branded.length}   Diary entries: ${entries.length}\n`);
console.log("Nutrient".padEnd(14) + "Common foods".padEnd(18) + "Branded foods".padEnd(18) + "Diary entries");
for (const [key, label] of KEYS) {
  const c = common.filter((f) => lists(f.nutrition100g?.micros, key)).length;
  const b = branded.filter((f) => lists(f.nutrition100g?.micros, key)).length;
  const e = entries.filter((x) => lists(x.micros, key)).length;
  console.log(label.padEnd(14) + `${c}/${common.length} ${pct(c, common.length)}`.padEnd(18) + `${b}/${branded.length} ${pct(b, branded.length)}`.padEnd(18) + `${e}/${entries.length} ${pct(e, entries.length)}`);
}
const anyFood = (f) => KEYS.some(([k]) => lists(f.nutrition100g?.micros, k));
console.log(`\nFoods listing at least one: common ${common.filter(anyFood).length}/${common.length}, branded ${branded.filter(anyFood).length}/${branded.length}.`);
console.log(`Diary entries listing at least one: ${entries.filter((x) => KEYS.some(([k]) => lists(x.micros, k))).length}/${entries.length}.`);
console.log("\nA low share is expected for packaged foods and AI-estimated entries (those carry none). The common foods list carries none until a vetted source is imported.");
