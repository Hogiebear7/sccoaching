// Read-only operational report on Google Play App Subscription state. Counts only.
//
//   node scripts/iap-report.mjs
//
// Prints how many purchases are in each state, how many need attention (unacknowledged, failed acknowledgement,
// revoked, expired but still marked active), and a tally of audit events by type. It NEVER prints a user id, a purchase
// token, a token hash, a binding value, an order id or any other identifier, and it NEVER writes. Set GYM_DB_PATH to
// point at a copy of the datastore (used by tests; also the safe way to inspect a backup).
//
// Use it to answer: "is anything stuck?" See docs/google-play-iap-runbook-2026-10.md.

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));
if (!existsSync(DB_PATH)) {
  console.error(`✗ Database not found at ${DB_PATH}.`);
  process.exit(1);
}

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));
const purchases = db.googlePlayPurchases ?? [];
const events = db.iapEvents ?? [];
const notifications = db.iapNotifications ?? [];
const now = Date.now();

const tally = (rows, key) => {
  const out = {};
  for (const row of rows) out[row[key] ?? "unknown"] = (out[row[key] ?? "unknown"] ?? 0) + 1;
  return out;
};
const print = (title, counts) => {
  console.log(`\n${title}`);
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) console.log("  (none)");
  for (const [k, v] of entries) console.log(`  ${k.padEnd(28)} ${v}`);
};

console.log("Google Play App Subscription report (read-only, counts only)");
console.log(`  purchases: ${purchases.length}   audit events: ${events.length}   notifications seen: ${notifications.length}`);

print("Purchases by status", tally(purchases, "status"));
print("Acknowledgement state", tally(purchases.map((p) => ({ s: p.acknowledgementState ?? (p.acknowledged ? "acknowledged (legacy)" : "pending (legacy)") })), "s"));

const attention = {
  "unacknowledged": purchases.filter((p) => !p.acknowledged && !p.revokedAt).length,
  "acknowledgement failed": purchases.filter((p) => p.acknowledgementState === "failed").length,
  "acknowledgement attempts at cap (10)": purchases.filter((p) => (p.acknowledgementAttempts ?? 0) >= 10 && !p.acknowledged).length,
  "revoked": purchases.filter((p) => p.revokedAt).length,
  "marked active but past expiry": purchases.filter((p) => ["active", "canceled", "in_grace_period"].includes(p.status) && p.expiryTimeMillis && p.expiryTimeMillis < now && !p.revokedAt).length,
  "never reconciled or snapshot over 24h old": purchases.filter((p) => !p.revokedAt && p.status !== "expired" && (!p.lastSnapshotAt || now - new Date(p.lastSnapshotAt).getTime() > 24 * 3600 * 1000)).length,
  "legacy rows without the IAP fields": purchases.filter((p) => p.purchaseTokenHash === undefined).length,
};
print("Needs attention", attention);

print("Audit events by type", tally(events, "type"));
const incomplete = notifications.filter((n) => !n.processedAt).length;
print("Notifications", { processed: notifications.length - incomplete, "not completed (retrying)": incomplete, "gave up": notifications.filter((n) => n.outcome === "gave_up").length });

const subs = (db.subscriptions ?? []).filter((s) => s.provider === "google_play");
print("Google Play-billed subscription rows by status", tally(subs, "status"));
console.log("\nNothing was written.\n");
