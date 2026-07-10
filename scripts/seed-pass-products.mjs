// Seeds class pass pack products for local/sandbox testing. Idempotent:
// existing products (by id) are left untouched. Run with:
//   node scripts/seed-pass-products.mjs
import { readFileSync, writeFileSync } from "fs";

const DB_PATH = new URL("../data/db.json", import.meta.url);
const now = new Date().toISOString();

const PRODUCTS = [
  {
    id: "pack_5",
    name: "5 Class Pass Pack",
    description: "Five extra class passes on top of your monthly allowance.",
    passCount: 5,
    priceCents: 6500,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "pack_10",
    name: "10 Class Pass Pack",
    description: "Ten extra class passes — best value.",
    passCount: 10,
    priceCents: 12000,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  },
];

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));
db.classPassProducts ??= [];

let added = 0;
for (const product of PRODUCTS) {
  if (!db.classPassProducts.some((p) => p.id === product.id)) {
    db.classPassProducts.push(product);
    added++;
  }
}

writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
console.log(`seeded ${added} pass product(s); total now ${db.classPassProducts.length}`);
