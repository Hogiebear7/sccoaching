// One-off cleanup: remove the legacy Plans/Passes system from data/db.json.
//
// Trial data is disposable (confirmed), so this WIPES:
//   • all legacy subscriptions (planId, no packageId) — non-functional now
//     that the entitlement resolver is package-only,
//   • the membershipPlans collection,
//   • the classPassProducts collection.
//
// It KEEPS (shared infrastructure, not legacy):
//   • passLedger (member pass balances stay valid),
//   • pass_pack purchase history (refunds read the ledger, not the product).
//
// Idempotent: safe to re-run. Prints a summary of what was removed/retained.
import { readFileSync, writeFileSync } from "fs";

const DB_PATH = new URL("../data/db.json", import.meta.url);
const db = JSON.parse(readFileSync(DB_PATH, "utf8"));

const subs = db.subscriptions ?? [];
const legacySubs = subs.filter((s) => !s.packageId); // planId-only / bare rows
const keptSubs = subs.filter((s) => s.packageId);

const deletedPlans = (db.membershipPlans ?? []).length;
const deletedPassProducts = (db.classPassProducts ?? []).length;
const retainedLedger = (db.passLedger ?? []).length;
const retainedPassPurchases = (db.purchases ?? []).filter((p) => p.kind === "pass_pack").length;

// Wipe legacy subscriptions; strip any residual planId from survivors.
db.subscriptions = keptSubs.map((s) => {
  const clean = { ...s };
  delete clean.planId;
  return clean;
});

// Drop the legacy collections entirely.
delete db.membershipPlans;
delete db.classPassProducts;

writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");

console.log("Legacy Plans/Passes removal — summary");
console.log("  Deleted legacy subscriptions:", legacySubs.length);
console.log("  Deleted membership plans:     ", deletedPlans);
console.log("  Deleted class-pass products:  ", deletedPassProducts);
console.log("  Retained pass-ledger entries: ", retainedLedger);
console.log("  Retained pass_pack purchases: ", retainedPassPurchases);
console.log("  Subscriptions remaining:      ", db.subscriptions.length);
