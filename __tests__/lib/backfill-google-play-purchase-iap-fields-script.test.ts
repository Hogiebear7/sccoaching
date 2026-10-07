// scripts/backfill-google-play-purchase-iap-fields.mjs: fills the additive IAP fields onto legacy
// Google Play purchase rows. Runs against an ISOLATED temp db file (GYM_DB_PATH), never data/db.json.
//   * dry run is the default and --report is read-only; --confirm backs the file up first
//   * only absent fields are filled; ownership and the purchase token are never changed
//   * idempotent: a second --confirm changes nothing
//   * counts only in the output: no user id, no token, no hash
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(process.cwd(), "scripts/backfill-google-play-purchase-iap-fields.mjs");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

let dir: string;
let dbPath: string;

const legacy = (over: Record<string, unknown>) => ({
  id: "p",
  userId: "user-x",
  productId: "app_subscription",
  basePlanId: "monthly",
  orderId: null,
  linkedPurchaseToken: null,
  status: "active",
  acknowledged: false,
  autoRenewing: true,
  startTimeMillis: 1,
  expiryTimeMillis: 2,
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
  ...over,
});

const fixture = () => ({
  googlePlayPurchases: [
    legacy({ id: "p1", userId: "user-1", purchaseToken: "fake-token-1", acknowledged: true }),
    legacy({ id: "p2", userId: "user-2", purchaseToken: "fake-token-2", acknowledged: false }),
    legacy({
      id: "p3",
      userId: "user-3",
      purchaseToken: "fake-token-3",
      purchaseTokenHash: "already-set",
      boundAt: "2026-01-05T00:00:00.000Z",
      acknowledgementState: "failed",
      acknowledgementAttempts: 4,
      lastSnapshotAt: "2026-03-05T00:00:00.000Z",
    }),
    legacy({ id: "p4", userId: "user-4" }),
  ],
  subscriptions: [{ userId: "user-1", packageId: "pkg", status: "active" }],
});

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, GYM_DB_PATH: dbPath }, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const readDb = () => JSON.parse(readFileSync(dbPath, "utf8"));
const byId = (id: string) => readDb().googlePlayPurchases.find((p: { id: string }) => p.id === id);
const backups = () => readdirSync(dir).filter((f) => f.includes(".bak-"));

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "backfill-gp-iap-"));
  dbPath = path.join(dir, "db.json");
  writeFileSync(dbPath, JSON.stringify(fixture(), null, 2));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("backfill-google-play-purchase-iap-fields script", () => {
  it("writes nothing by default or with --report, and says so", () => {
    const before = readFileSync(dbPath, "utf8");
    for (const args of [[], ["--report"]]) {
      const r = run(...args);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/DRY RUN/);
      expect(r.out).toMatch(/Nothing written/);
      expect(readFileSync(dbPath, "utf8")).toBe(before);
    }
    expect(backups()).toEqual([]);
  });

  it("rejects --report together with --confirm and unknown arguments", () => {
    expect(run("--report", "--confirm").code).toBe(1);
    expect(run("--wat").code).toBe(1);
  });

  it("fills only absent fields from data the row already holds", () => {
    const r = run("--confirm");
    expect(r.code).toBe(0);
    expect(byId("p1")).toMatchObject({
      purchaseTokenHash: sha("fake-token-1"),
      boundAt: "2026-02-01T00:00:00.000Z",
      acknowledgementState: "acknowledged",
      acknowledgementAttempts: 0,
      lastSnapshotAt: "2026-03-01T00:00:00.000Z",
    });
    expect(byId("p2")).toMatchObject({ acknowledgementState: "pending", purchaseTokenHash: sha("fake-token-2") });
  });

  it("never overwrites a field that is already set", () => {
    run("--confirm");
    expect(byId("p3")).toMatchObject({
      purchaseTokenHash: "already-set",
      boundAt: "2026-01-05T00:00:00.000Z",
      acknowledgementState: "failed",
      acknowledgementAttempts: 4,
      lastSnapshotAt: "2026-03-05T00:00:00.000Z",
    });
  });

  it("never changes ownership, tokens or unrelated collections, and skips a row with no token", () => {
    const before = readDb();
    const r = run("--confirm");
    const after = readDb();
    for (const [i, row] of after.googlePlayPurchases.entries()) {
      expect(row.userId).toBe(before.googlePlayPurchases[i].userId);
      expect(row.purchaseToken).toBe(before.googlePlayPurchases[i].purchaseToken);
    }
    expect(after.subscriptions).toEqual(before.subscriptions);
    expect(byId("p4").purchaseTokenHash).toBeUndefined();
    expect(r.out).toMatch(/skipped \(no usable purchase token\): 1/);
  });

  it("backs the file up before writing, and is idempotent on a second run", () => {
    run("--confirm");
    expect(backups()).toHaveLength(1);
    const once = readFileSync(dbPath, "utf8");
    const second = run("--confirm");
    expect(second.out).toMatch(/0 to update/);
    expect(readFileSync(dbPath, "utf8")).toBe(once);
  });

  it("prints counts only: no user id, no purchase token, no hash", () => {
    const out = [run("--report").out, run("--confirm").out].join("\n");
    for (const secret of ["user-1", "user-2", "fake-token-1", "fake-token-2", sha("fake-token-1"), sha("fake-token-2")]) {
      expect(out).not.toContain(secret);
    }
  });

  it("reports a duplicated purchase token without resolving it", () => {
    const db = fixture();
    db.googlePlayPurchases.push(legacy({ id: "p5", userId: "user-5", purchaseToken: "fake-token-1" }));
    writeFileSync(dbPath, JSON.stringify(db, null, 2));
    const r = run("--report");
    expect(r.out).toMatch(/1 row\(s\) share a purchase token/);
    expect(readDb().googlePlayPurchases).toHaveLength(5);
  });

  it("handles a datastore with no purchases at all", () => {
    writeFileSync(dbPath, JSON.stringify({ subscriptions: [] }));
    const r = run("--confirm");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/0 total/);
  });
});
