// Populates the "Common" food catalog with a starter set of generic, non-
// branded staple foods (real per-100g USDA-reference nutrition values —
// protein/carbs/fat only; micronutrients are left null rather than guessed).
// Mirrors scripts/seed-exercise-library.mjs's shape and safety pattern.
// Additive and idempotent — skips any name already present, so it's safe to
// re-run after staff/admin add their own common foods.
//
//   npm run seed:common-foods
//   npm run seed:common-foods -- --confirm
//
// Safety:
//  - Dry run by default; nothing is written without --confirm.
//  - Backs up data/db.json to data/db.json.bak-<ts> before writing.
// Set GYM_DB_PATH to target a different db file (used by tests).

import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));
const CONFIRM = process.argv.slice(2).includes("--confirm");

if (!existsSync(DB_PATH)) {
  console.error(`✗ Database not found at ${DB_PATH}.`);
  process.exit(1);
}

// [name, calories, proteinG, carbsG, fatG, defaultServingLabel, defaultServingGrams]
const f = (name, calories, proteinG, carbsG, fatG, servingLabel, servingGrams) => ({
  name,
  calories,
  proteinG,
  carbsG,
  fatG,
  servingLabel,
  servingGrams,
});

const STARTER_COMMON_FOODS = [
  // Proteins
  f("Chicken Breast, Cooked", 165, 31, 0, 3.6, "100g", 100),
  f("Chicken Thigh, Cooked", 209, 26, 0, 10.9, "100g", 100),
  f("Salmon, Cooked", 208, 20, 0, 13, "100g", 100),
  f("Tuna, Canned in Water", 116, 26, 0, 0.8, "1 can (142g)", 142),
  f("Egg, Whole, Cooked", 155, 13, 1.1, 11, "1 large (50g)", 50),
  f("Egg White", 52, 11, 0.7, 0.2, "1 large (33g)", 33),
  f("Beef, Ground 90/10, Cooked", 217, 26, 0, 12, "100g", 100),
  f("Beef Sirloin Steak, Cooked", 201, 29, 0, 8.5, "100g", 100),
  f("Pork Loin, Cooked", 202, 27, 0, 9.6, "100g", 100),
  f("Turkey Breast, Cooked", 135, 30, 0, 1, "100g", 100),
  f("Shrimp, Cooked", 99, 24, 0.2, 0.3, "100g", 100),
  f("Tofu, Firm", 144, 15.8, 2.8, 8.7, "100g", 100),
  f("Greek Yogurt, Plain Nonfat", 59, 10, 3.6, 0.4, "170g cup", 170),
  f("Cottage Cheese, Low-Fat", 72, 12, 4, 1, "100g", 100),
  f("Whey Protein Powder", 400, 80, 8, 5, "1 scoop (30g)", 30),

  // Carbohydrates
  f("White Rice, Cooked", 130, 2.7, 28, 0.3, "1 cup (158g)", 158),
  f("Brown Rice, Cooked", 123, 2.7, 26, 1, "1 cup (195g)", 195),
  f("Oats, Dry", 389, 17, 66, 7, "40g", 40),
  f("Potato, Baked with Skin", 93, 2.5, 21, 0.1, "1 medium (173g)", 173),
  f("Sweet Potato, Baked", 90, 2, 21, 0.2, "1 medium (130g)", 130),
  f("Whole Wheat Bread", 247, 13, 41, 3.4, "1 slice (28g)", 28),
  f("White Bread", 265, 9, 49, 3.2, "1 slice (25g)", 25),
  f("Pasta, Cooked", 131, 5, 25, 1.1, "1 cup (140g)", 140),
  f("Quinoa, Cooked", 120, 4.4, 21, 1.9, "1 cup (185g)", 185),

  // Fruits
  f("Banana", 89, 1.1, 23, 0.3, "1 medium (118g)", 118),
  f("Apple", 52, 0.3, 14, 0.2, "1 medium (182g)", 182),
  f("Orange", 47, 0.9, 12, 0.1, "1 medium (131g)", 131),
  f("Strawberries", 32, 0.7, 7.7, 0.3, "1 cup (152g)", 152),
  f("Blueberries", 57, 0.7, 14, 0.3, "1 cup (148g)", 148),
  f("Grapes", 69, 0.7, 18, 0.2, "1 cup (151g)", 151),
  f("Avocado", 160, 2, 8.5, 14.7, "1/2 medium (100g)", 100),

  // Vegetables
  f("Broccoli, Cooked", 35, 2.4, 7.2, 0.4, "1 cup (156g)", 156),
  f("Spinach, Raw", 23, 2.9, 3.6, 0.4, "1 cup (30g)", 30),
  f("Carrots, Raw", 41, 0.9, 10, 0.2, "1 medium (61g)", 61),
  f("Green Beans", 31, 1.8, 7, 0.2, "1 cup (100g)", 100),
  f("Bell Pepper", 31, 1, 6, 0.3, "1 medium (119g)", 119),

  // Dairy & fats
  f("Milk, Whole", 61, 3.2, 4.8, 3.3, "1 cup (244g)", 244),
  f("Milk, Skim", 34, 3.4, 5, 0.1, "1 cup (245g)", 245),
  f("Cheddar Cheese", 403, 25, 1.3, 33, "1 slice (28g)", 28),
  f("Peanut Butter", 588, 25, 20, 50, "2 tbsp (32g)", 32),
  f("Olive Oil", 884, 0, 0, 100, "1 tbsp (14g)", 14),
  f("Almonds", 579, 21, 22, 50, "1 oz (28g)", 28),
  f("Peanuts", 567, 26, 16, 49, "1 oz (28g)", 28),

  // Legumes
  f("Black Beans, Cooked", 132, 8.9, 24, 0.5, "1 cup (172g)", 172),
  f("Chickpeas, Cooked", 164, 8.9, 27, 2.6, "1 cup (164g)", 164),
  f("Lentils, Cooked", 116, 9, 20, 0.4, "1 cup (198g)", 198),
];

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));
const existing = db.commonFoods ?? [];
const existingNames = new Set(existing.map((f) => f.name.trim().toLowerCase()));

const toAdd = STARTER_COMMON_FOODS.filter((f) => !existingNames.has(f.name.trim().toLowerCase()));
const skipped = STARTER_COMMON_FOODS.filter((f) => existingNames.has(f.name.trim().toLowerCase()));

console.log(`\nSeed common foods — ${CONFIRM ? "APPLYING" : "DRY RUN"}\n`);
console.log(`Foods to add (${toAdd.length}):`);
for (const f of toAdd) console.log(`  + ${f.name} (${f.calories} kcal/100g)`);
if (skipped.length > 0) {
  console.log(`\nAlready present, skipped (${skipped.length}): ${skipped.map((f) => f.name).join(", ")}`);
}

if (toAdd.length === 0) {
  console.log(`\nNothing to do.\n`);
  process.exit(0);
}

if (!CONFIRM) {
  console.log(`\nNothing written. Re-run with --confirm to apply.\n`);
  process.exit(0);
}

const backup = `${DB_PATH}.bak-${Date.now()}`;
copyFileSync(DB_PATH, backup);

const now = new Date().toISOString();
db.commonFoods = [
  ...existing,
  ...toAdd.map((food) => {
    const defaultServing = { label: food.servingLabel, grams: food.servingGrams };
    const hundredGram = { label: "100g", grams: 100 };
    return {
      id: randomUUID(),
      domain: "common",
      name: food.name,
      brandName: null,
      barcode: null,
      nutrition100g: {
        calories: food.calories,
        proteinG: food.proteinG,
        carbsG: food.carbsG,
        fatG: food.fatG,
        fiberG: null,
        sugarG: null,
        sodiumMg: null,
        saturatedFatG: null,
      },
      defaultServing,
      servings: defaultServing.label === hundredGram.label ? [hundredGram] : [defaultServing, hundredGram],
      provenance: "usda_seed",
      sourceRef: null,
      verified: true,
      region: null,
      ownerUserId: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      fetchedAt: null,
    };
  }),
];

writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");

console.log(`\n✓ Added ${toAdd.length} common food(s) to the library.`);
console.log(`  Backup written: ${backup}\n`);
