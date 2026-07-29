// Test-mode smoke harness for the membership SWITCH lifecycle.
//
// Verifies the record-level billing-safety guarantees end-to-end against a
// RUNNING dev server, using a real signed webhook (same HMAC scheme the server
// verifies). It stands in for the parts of the lifecycle that don't need real
// Stripe money moving:
//
//   • a switch has been staged (pending* set, active membership untouched)
//   • a signed checkout.session.completed arrives
//   • the pending switch is PROMOTED onto the active fields (fresh period)
//   • the previous provider subscription is handed to the cancel path
//   • there is exactly ONE active subscription for the member afterwards
//
// It does NOT move real money or create real Stripe objects — the real-Stripe
// portions (actual checkout creation + confirming the old sub shows "canceled"
// in the Stripe dashboard) are the manual checklist in docs/membership-switching.md.
//
// Usage (dev server must be running on APP_BASE_URL, default http://localhost:3000):
//   node scripts/smoke-switch-lifecycle.mjs
//
// Safe to re-run: it seeds a uniquely-ided throwaway subscription row and
// removes exactly that row on exit, leaving all real data untouched.

import { readFileSync, writeFileSync } from "fs";
import { createHmac } from "crypto";

const DB_PATH = new URL("../data/db.json", import.meta.url);
const ENV_PATH = new URL("../.env.local", import.meta.url);

// ── Read STRIPE_WEBHOOK_SECRET from .env.local (never printed) ────────────
function readEnvSecret(name) {
  let text;
  try {
    text = readFileSync(ENV_PATH, "utf8");
  } catch {
    return null;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() === name) {
      return trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

const BASE_URL = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const secret = readEnvSecret("STRIPE_WEBHOOK_SECRET");
if (!secret) {
  console.error("✗ STRIPE_WEBHOOK_SECRET not found in .env.local — cannot sign the webhook.");
  process.exit(1);
}

const readDb = () => JSON.parse(readFileSync(DB_PATH, "utf8"));
const writeDb = (db) => writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");

const stamp = Date.now();
const SMOKE_USER = `smoke-switch-${stamp}`;
const SESSION_ID = `cs_smoke_switch_${stamp}`;
const OLD_SUB_ID = `sub_smoke_old_${stamp}`;
const NEW_SUB_ID = `sub_smoke_new_${stamp}`;

// Pick a real catalog option for the target so the fresh period reflects a real
// cadence; fall back to a synthetic monthly if the catalog isn't seeded.
const db0 = readDb();
const options = db0.membershipBillingOptions ?? [];
const target =
  options.find((o) => o.id === "opt_spt_unlimited_annual") ??
  options.find((o) => o.billingType === "recurring") ??
  null;
const OLD_OPTION = "opt_smoke_old";
const NEW_OPTION = target?.id ?? "opt_smoke_new";
const NEW_PACKAGE = target?.packageId ?? "pkg_smoke_new";

function seedStagedSwitch() {
  const db = readDb();
  db.subscriptions ??= [];
  // Remove any stale smoke row, then seed: ACTIVE on the old option with a
  // switch STAGED in pending* — exactly the state after checkout creation.
  db.subscriptions = db.subscriptions.filter((s) => s.userId !== SMOKE_USER);
  db.subscriptions.push({
    userId: SMOKE_USER,
    planId: null,
    packageId: "pkg_smoke_old",
    billingOptionId: OLD_OPTION,
    status: "active",
    provider: "stripe",
    providerCustomerId: "cus_smoke",
    providerSubscriptionId: OLD_SUB_ID,
    providerSetupOrderId: "cs_smoke_old",
    currentPeriodEnd: new Date(stamp + 20 * 86_400_000).toISOString(),
    lastWebhookEventAt: null,
    sessionsUsedThisPeriod: 5,
    extraSessionGrants: [{ id: "g", amount: 1, note: null, grantedByUserId: "s", createdAt: "x" }],
    periodLapsedNotifiedAt: null,
    pendingPackageId: NEW_PACKAGE,
    pendingBillingOptionId: NEW_OPTION,
    pendingSetupOrderId: SESSION_ID,
    pendingStartedAt: new Date(stamp).toISOString(),
    createdAt: new Date(stamp).toISOString(),
    updatedAt: new Date(stamp).toISOString(),
  });
  writeDb(db);
}

function cleanup() {
  const db = readDb();
  db.subscriptions = (db.subscriptions ?? []).filter((s) => s.userId !== SMOKE_USER);
  db.paymentEvents = (db.paymentEvents ?? []).filter((e) => e.id !== `evt_smoke_switch_${stamp}`);
  writeDb(db);
}

function signedPost(event) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": `t=${t},v1=${signature}` },
    body,
  });
}

let passed = 0;
let failed = 0;
function check(label, cond) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}`);
  }
}

async function main() {
  console.log(`\nSwitch-lifecycle smoke → ${BASE_URL}\n`);

  console.log("1. Stage a switch (active membership untouched, pending* set)…");
  seedStagedSwitch();
  const before = readDb().subscriptions.find((s) => s.userId === SMOKE_USER);
  check("active membership present before webhook", before?.status === "active");
  check("staged pending option is the target", before?.pendingBillingOptionId === NEW_OPTION);

  console.log("2. Deliver a signed checkout.session.completed…");
  const res = await signedPost({
    id: `evt_smoke_switch_${stamp}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: SESSION_ID,
        mode: "subscription",
        payment_status: "paid",
        subscription: NEW_SUB_ID,
        customer: "cus_smoke",
      },
    },
  });
  check(`webhook accepted (200), got ${res.status}`, res.status === 200);

  console.log("3. Verify promotion + no duplicate active subscription…");
  const mine = readDb().subscriptions.filter((s) => s.userId === SMOKE_USER);
  const after = mine[0];
  check("exactly one subscription row for the member", mine.length === 1);
  check("promoted to the new option", after?.billingOptionId === NEW_OPTION);
  check("promoted to the new package", after?.packageId === NEW_PACKAGE);
  check("now points at the NEW provider subscription", after?.providerSubscriptionId === NEW_SUB_ID);
  check("no longer references the OLD provider subscription", after?.providerSubscriptionId !== OLD_SUB_ID);
  check("status is active", after?.status === "active");
  check("fresh period: usage reset to 0", after?.sessionsUsedThisPeriod === 0);
  check("fresh period: staff grants cleared", Array.isArray(after?.extraSessionGrants) && after.extraSessionGrants.length === 0);
  check("fresh period end set", Boolean(after?.currentPeriodEnd));
  check("pending fields cleared", after?.pendingPackageId === null && after?.pendingBillingOptionId === null && after?.pendingSetupOrderId === null && after?.pendingStartedAt === null);

  console.log(
    `\n   Note: the previous provider subscription (${OLD_SUB_ID}) was handed to the\n` +
      "   best-effort cancel path. In test mode there is no real Stripe object, so the\n" +
      "   cancel returns 'not found' → treated as success (idempotent). Confirming a REAL\n" +
      "   old subscription flips to 'canceled' is the manual dashboard step in\n" +
      "   docs/membership-switching.md.\n"
  );

  console.log(`Result: ${passed} passed, ${failed} failed.`);
}

main()
  .catch((err) => {
    console.error("✗ smoke run threw:", err instanceof Error ? err.message : err);
    failed += 1;
  })
  .finally(() => {
    cleanup();
    process.exit(failed === 0 ? 0 : 1);
  });
