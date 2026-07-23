// Seeds the membership catalog (Category → Package → Billing Option) for
// local/sandbox testing. Idempotent: rows are keyed by stable ids and
// re-seeding overwrites those rows only — existing plans, passes,
// subscriptions and other catalog rows are left untouched. Run with:
//   node scripts/seed-catalog.mjs
import { readFileSync, writeFileSync } from "fs";

const DB_PATH = new URL("../data/db.json", import.meta.url);
const now = new Date().toISOString();

function cat(id, name, sortOrder, description) {
  return { id, name, slug: id.replace(/^cat_/, ""), description: description ?? null, sortOrder, visible: true, createdAt: now, updatedAt: now };
}
function pkg(id, categoryId, name, packageType, allowanceType, count, eligible, sortOrder, short) {
  return {
    id, categoryId, name, slug: id.replace(/^pkg_/, ""),
    shortDescription: short ?? null, fullDescription: null,
    packageType, sessionAllowanceType: allowanceType, sessionAllowanceCount: count,
    eligibleClassTypes: eligible, visible: true, sortOrder, stripeProductId: null,
    createdAt: now, updatedAt: now,
  };
}
function recurring(id, packageId, name, interval, priceEur, sortOrder) {
  const [unit, count] = interval === "annual" ? ["year", 1] : interval === "quarterly" ? ["month", 3] : ["month", 1];
  return { id, packageId, name, billingType: "recurring", intervalUnit: unit, intervalCount: count, amountCents: Math.round(priceEur * 100), currency: "eur", visible: true, sortOrder, stripePriceId: null, createdAt: now, updatedAt: now };
}
function oneTime(id, packageId, name, priceEur, sortOrder) {
  return { id, packageId, name, billingType: "one_time", intervalUnit: null, intervalCount: null, amountCents: Math.round(priceEur * 100), currency: "eur", visible: true, sortOrder, stripePriceId: null, createdAt: now, updatedAt: now };
}

const categories = [
  cat("cat_semi_private_pt", "Semi-Private PT", 0, "Small-group personal training."),
  cat("cat_parent_and_baby", "Parent & Baby Classes", 1, "Train with your little one."),
  cat("cat_older_athletes", "Older Athletes", 2, "Strength & mobility for older members."),
];

const packages = [
  // Semi-Private PT
  pkg("pkg_spt_unlimited", "cat_semi_private_pt", "Unlimited Sessions", "membership", "unlimited", null, ["semi_private_pt"], 0, "Book as often as you like."),
  pkg("pkg_spt_12", "cat_semi_private_pt", "12 Sessions", "membership", "fixed_count", 12, ["semi_private_pt"], 1, "12 sessions each period."),
  pkg("pkg_spt_8", "cat_semi_private_pt", "8 Sessions", "membership", "fixed_count", 8, ["semi_private_pt"], 2, "8 sessions each period."),
  pkg("pkg_spt_pass", "cat_semi_private_pt", "One Class Pass", "pass", "single_use", 1, ["semi_private_pt"], 3, "A single drop-in session."),
  // Parent & Baby
  pkg("pkg_pnb_20", "cat_parent_and_baby", "20 Classes", "pass", "fixed_count", 20, ["parent_and_baby"], 0, "A 20-class pack."),
  pkg("pkg_pnb_10", "cat_parent_and_baby", "10 Classes", "pass", "fixed_count", 10, ["parent_and_baby"], 1, "A 10-class pack."),
  pkg("pkg_pnb_5", "cat_parent_and_baby", "5 Classes", "pass", "fixed_count", 5, ["parent_and_baby"], 2, "A 5-class pack."),
  pkg("pkg_pnb_pass", "cat_parent_and_baby", "One Class Pass", "pass", "single_use", 1, ["parent_and_baby"], 3, "A single drop-in class."),
  // Older Athletes
  pkg("pkg_oa_20", "cat_older_athletes", "20 Classes", "pass", "fixed_count", 20, ["general"], 0, "A 20-class pack."),
  pkg("pkg_oa_10", "cat_older_athletes", "10 Classes", "pass", "fixed_count", 10, ["general"], 1, "A 10-class pack."),
  pkg("pkg_oa_5", "cat_older_athletes", "5 Classes", "pass", "fixed_count", 5, ["general"], 2, "A 5-class pack."),
  pkg("pkg_oa_pass", "cat_older_athletes", "One Class Pass", "pass", "single_use", 1, ["general"], 3, "A single drop-in class."),
];

const billingOptions = [
  // Semi-Private PT → Unlimited (the spec's example pricing)
  recurring("opt_spt_unlimited_monthly", "pkg_spt_unlimited", "Monthly", "monthly", 250, 0),
  recurring("opt_spt_unlimited_quarterly", "pkg_spt_unlimited", "Quarterly", "quarterly", 720, 1),
  recurring("opt_spt_unlimited_annual", "pkg_spt_unlimited", "Annual", "annual", 2750, 2),
  // Semi-Private PT → 12 / 8 Sessions
  recurring("opt_spt_12_monthly", "pkg_spt_12", "Monthly", "monthly", 160, 0),
  recurring("opt_spt_8_monthly", "pkg_spt_8", "Monthly", "monthly", 120, 0),
  oneTime("opt_spt_pass", "pkg_spt_pass", "One-off", 35, 0),
  // Parent & Baby (one-time class packs)
  oneTime("opt_pnb_20", "pkg_pnb_20", "One-off", 200, 0),
  oneTime("opt_pnb_10", "pkg_pnb_10", "One-off", 110, 0),
  oneTime("opt_pnb_5", "pkg_pnb_5", "One-off", 60, 0),
  oneTime("opt_pnb_pass", "pkg_pnb_pass", "One-off", 14, 0),
  // Older Athletes (one-time class packs)
  oneTime("opt_oa_20", "pkg_oa_20", "One-off", 190, 0),
  oneTime("opt_oa_10", "pkg_oa_10", "One-off", 105, 0),
  oneTime("opt_oa_5", "pkg_oa_5", "One-off", 58, 0),
  oneTime("opt_oa_pass", "pkg_oa_pass", "One-off", 13, 0),
];

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));
db.membershipCategories ??= [];
db.membershipPackages ??= [];
db.membershipBillingOptions ??= [];

function upsert(coll, rows) {
  for (const row of rows) {
    const i = coll.findIndex((r) => r.id === row.id);
    if (i === -1) coll.push(row);
    else coll[i] = row;
  }
}
upsert(db.membershipCategories, categories);
upsert(db.membershipPackages, packages);
upsert(db.membershipBillingOptions, billingOptions);

writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
console.log(
  `seeded ${categories.length} categories, ${packages.length} packages, ${billingOptions.length} billing options`
);
