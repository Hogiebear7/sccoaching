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
  f("Kidney Beans, Cooked", 127, 8.7, 22.8, 0.5, "1 cup (177g)", 177),
  f("Edamame, Cooked", 121, 11, 10, 5, "1 cup (155g)", 155),
  f("Split Peas, Cooked", 118, 8.3, 21, 0.4, "1 cup (196g)", 196),

  // Breakfast / grains (additional)
  f("Porridge / Oatmeal, Cooked with Water", 71, 2.5, 12, 1.5, "1 cup (234g)", 234),
  f("Porridge / Oatmeal, Cooked with Milk", 89, 3.9, 12, 3, "1 cup (250g)", 250),
  f("Overnight Oats (Oats + Milk + Yogurt)", 120, 5.5, 17, 3.5, "1 cup (240g)", 240),
  f("Granola", 471, 10, 64, 20, "1/2 cup (61g)", 61),
  f("Muesli", 362, 10, 66, 6, "1/2 cup (55g)", 55),
  f("Bran Flakes Cereal", 320, 10, 81, 2, "1 cup (39g)", 39),
  f("Cornflakes Cereal", 357, 7.5, 84, 0.4, "1 cup (28g)", 28),
  f("Bagel, Plain", 257, 10, 50, 1.5, "1 medium (98g)", 98),
  f("English Muffin", 235, 8.2, 46, 1.8, "1 muffin (57g)", 57),
  f("Pancakes, Plain", 227, 6, 28, 10, "3 pancakes (114g)", 114),
  f("Waffles, Plain", 291, 7.9, 33, 14, "2 waffles (78g)", 78),
  f("Couscous, Cooked", 112, 3.8, 23, 0.2, "1 cup (157g)", 157),
  f("Barley, Cooked", 123, 2.3, 28, 0.4, "1 cup (157g)", 157),
  f("Corn Tortilla", 218, 5.7, 45, 2.9, "1 tortilla (26g)", 26),
  f("Flour Tortilla", 312, 8.2, 51, 7.6, "1 tortilla (49g)", 49),

  // Snacks (generic, unbranded)
  f("Crackers, Whole Wheat", 428, 9, 71, 12, "5 crackers (16g)", 16),
  f("Rice Cakes, Plain", 387, 8, 82, 2.8, "1 cake (9g)", 9),
  f("Pretzels", 380, 10, 79, 2.6, "1 oz (28g)", 28),
  f("Popcorn, Air-Popped", 387, 13, 78, 4.5, "1 cup (8g)", 8),
  f("Potato Chips", 536, 6.6, 53, 34, "1 oz (28g)", 28),
  f("Tortilla Chips", 489, 6.8, 63, 24, "1 oz (28g)", 28),
  f("Trail Mix, Nuts & Dried Fruit", 462, 13, 44, 29, "1/4 cup (36g)", 36),
  f("Protein Bar, Generic", 380, 30, 38, 12, "1 bar (60g)", 60),
  f("Energy/Granola Bar, Generic", 421, 8, 65, 15, "1 bar (40g)", 40),
  f("Dark Chocolate", 546, 4.9, 61, 31, "1 oz (28g)", 28),
  f("Milk Chocolate", 535, 7.7, 59, 30, "1 oz (28g)", 28),
  f("Hummus", 166, 7.9, 14, 9.6, "2 tbsp (30g)", 30),
  f("Dried Apricots", 241, 3.4, 63, 0.5, "1/4 cup (33g)", 33),
  f("Raisins", 299, 3.1, 79, 0.5, "1/4 cup (40g)", 40),
  f("Dates", 282, 2.5, 75, 0.4, "1/4 cup (37g)", 37),

  // Additional proteins
  f("Bacon, Cooked", 541, 37, 1.4, 42, "3 slices (24g)", 24),
  f("Ham, Sliced", 145, 21, 1.5, 5.5, "2 slices (56g)", 56),
  f("Sausage, Pork, Cooked", 325, 15, 2, 28, "1 link (68g)", 68),
  f("Tempeh", 192, 20, 7.6, 11, "100g", 100),
  f("Seitan", 370, 75, 14, 1.9, "100g", 100),
  f("Duck Breast, Cooked", 201, 23.5, 0, 11.2, "100g", 100),
  f("Lamb, Cooked", 258, 25, 0, 17, "100g", 100),
  f("Crab, Cooked", 97, 19, 0, 1.5, "100g", 100),
  f("Mussels, Cooked", 172, 24, 7.4, 4.5, "100g", 100),
  f("Cod, Cooked", 105, 23, 0, 0.9, "100g", 100),

  // Additional dairy / fats
  f("Yogurt, Whole Milk Plain", 61, 3.5, 4.7, 3.3, "170g cup", 170),
  f("Mozzarella Cheese", 280, 28, 3.1, 17, "1 oz (28g)", 28),
  f("Parmesan Cheese", 431, 38, 4.1, 29, "1 oz (28g)", 28),
  f("Feta Cheese", 264, 14, 4.1, 21, "1 oz (28g)", 28),
  f("Cream Cheese", 342, 6, 4.1, 34, "2 tbsp (29g)", 29),
  f("Butter", 717, 0.9, 0.1, 81, "1 tbsp (14g)", 14),
  f("Coconut Oil", 862, 0, 0, 100, "1 tbsp (14g)", 14),
  f("Cashews", 553, 18, 30, 44, "1 oz (28g)", 28),
  f("Walnuts", 654, 15, 14, 65, "1 oz (28g)", 28),
  f("Chia Seeds", 486, 17, 42, 31, "2 tbsp (24g)", 24),
  f("Flaxseed, Ground", 534, 18, 29, 42, "2 tbsp (14g)", 14),

  // Additional fruits & vegetables
  f("Pineapple", 50, 0.5, 13, 0.1, "1 cup (165g)", 165),
  f("Mango", 60, 0.8, 15, 0.4, "1 cup (165g)", 165),
  f("Watermelon", 30, 0.6, 7.6, 0.2, "1 cup (152g)", 152),
  f("Kiwi", 61, 1.1, 15, 0.5, "1 medium (69g)", 69),
  f("Pear", 57, 0.4, 15, 0.1, "1 medium (178g)", 178),
  f("Peach", 39, 0.9, 10, 0.3, "1 medium (150g)", 150),
  f("Cherries", 63, 1.1, 16, 0.2, "1 cup (138g)", 138),
  f("Cucumber", 15, 0.7, 3.6, 0.1, "1 cup (104g)", 104),
  f("Tomato", 18, 0.9, 3.9, 0.2, "1 medium (123g)", 123),
  f("Onion, Raw", 40, 1.1, 9.3, 0.1, "1 medium (110g)", 110),
  f("Cauliflower, Cooked", 23, 1.8, 4.1, 0.5, "1 cup (124g)", 124),
  f("Zucchini, Cooked", 17, 1.2, 3.1, 0.3, "1 cup (180g)", 180),
  f("Mushrooms, Cooked", 28, 2.2, 4.3, 0.5, "1 cup (156g)", 156),
  f("Kale, Raw", 49, 4.3, 8.8, 0.9, "1 cup (67g)", 67),
  f("Asparagus, Cooked", 22, 2.4, 4.1, 0.2, "1 cup (180g)", 180),
  f("Celery, Raw", 16, 0.7, 3, 0.2, "1 cup (101g)", 101),

  // Beverages (generic, unbranded)
  f("Coffee, Black", 2, 0.3, 0, 0, "1 cup (240ml)", 240),
  f("Tea, Black, Unsweetened", 1, 0, 0.3, 0, "1 cup (240ml)", 240),
  f("Orange Juice", 45, 0.7, 10, 0.2, "1 cup (248g)", 248),
  f("Almond Milk, Unsweetened", 15, 0.6, 0.6, 1.2, "1 cup (240ml)", 240),
  f("Oat Milk, Unsweetened", 47, 1, 8, 1.5, "1 cup (240ml)", 240),
  f("Soy Milk, Unsweetened", 33, 3.3, 1.8, 1.8, "1 cup (240ml)", 240),

  // Prepared dishes (generic, unbranded)
  f("Chicken Stir-Fry with Vegetables", 130, 14, 8, 5, "1 cup (200g)", 200),
  f("Spaghetti Bolognese", 151, 8, 15, 6, "1 cup (250g)", 250),
  f("Chicken Caesar Salad", 158, 12, 6, 10, "1 bowl (300g)", 300),
  f("Vegetable Soup", 44, 1.8, 8.5, 0.6, "1 cup (245g)", 245),
  f("Chili con Carne", 133, 10, 12, 5.5, "1 cup (250g)", 250),
  f("Sushi Roll, California", 145, 4.5, 25, 3, "6 pieces (150g)", 150),
  f("Pizza, Cheese, Regular Crust", 266, 11, 33, 10, "1 slice (107g)", 107),
  f("Burrito, Chicken & Rice", 173, 9, 20, 6, "1 burrito (250g)", 250),
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
