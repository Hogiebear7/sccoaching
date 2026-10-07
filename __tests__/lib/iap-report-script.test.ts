// scripts/iap-report.mjs: read-only, counts only. Runs against an ISOLATED temp db file (GYM_DB_PATH), never data/db.json.
import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(process.cwd(), "scripts/iap-report.mjs");
let dir: string;
let dbPath: string;

const run = () => {
  const r = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, GYM_DB_PATH: dbPath }, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

const purchase = (over: Record<string, unknown>) => ({
  id: "p",
  userId: "secret-user-id",
  purchaseToken: "secret-purchase-token",
  productId: "app_subscription",
  orderId: "GPA.secret-order",
  status: "active",
  acknowledged: true,
  expiryTimeMillis: Date.now() + 86_400_000,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "iap-report-"));
  dbPath = path.join(dir, "db.json");
  writeFileSync(
    dbPath,
    JSON.stringify({
      googlePlayPurchases: [
        purchase({ id: "a", purchaseTokenHash: "secret-hash", acknowledgementState: "acknowledged", lastSnapshotAt: new Date().toISOString() }),
        purchase({ id: "b", acknowledged: false, acknowledgementState: "failed", acknowledgementAttempts: 10 }),
        purchase({ id: "c", status: "active", expiryTimeMillis: Date.now() - 86_400_000 }),
        purchase({ id: "d", revokedAt: "2026-02-01T00:00:00.000Z", status: "expired" }),
      ],
      iapEvents: [{ type: "purchase_claimed", userId: "secret-user-id" }, { type: "purchase_claimed", userId: "x" }, { type: "entitlement_revoked", userId: "x" }],
      iapNotifications: [{ messageId: "secret-message", processedAt: "2026-02-01T00:00:00.000Z", outcome: "applied" }, { messageId: "m2", processedAt: null, outcome: null }],
      subscriptions: [{ userId: "secret-user-id", provider: "google_play", status: "active" }, { userId: "y", provider: "none", status: "active" }],
    })
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("iap-report script", () => {
  it("reports the counts that matter", () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/purchases: 4/);
    expect(r.out).toMatch(/acknowledgement failed\s+1/);
    expect(r.out).toMatch(/attempts at cap \(10\)\s+1/);
    expect(r.out).toMatch(/revoked\s+1/);
    expect(r.out).toMatch(/marked active but past expiry\s+1/);
    expect(r.out).toMatch(/purchase_claimed\s+2/);
    expect(r.out).toMatch(/not completed \(retrying\)\s+1/);
    expect(r.out).toMatch(/Google Play-billed subscription rows by status[\s\S]*active\s+1/);
  });

  it("never prints an identifier, token, hash or order id", () => {
    const out = run().out;
    for (const secret of ["secret-user-id", "secret-purchase-token", "secret-hash", "GPA.secret-order", "secret-message"]) expect(out).not.toContain(secret);
  });

  it("never writes", () => {
    const before = readFileSync(dbPath, "utf8");
    run();
    expect(readFileSync(dbPath, "utf8")).toBe(before);
  });

  it("handles a datastore with no Google Play data, and a missing file", () => {
    writeFileSync(dbPath, JSON.stringify({}));
    expect(run().code).toBe(0);
    rmSync(dbPath);
    expect(run().code).toBe(1);
  });
});
