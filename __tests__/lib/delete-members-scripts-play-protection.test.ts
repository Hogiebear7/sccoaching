// scripts/delete-members.mjs and scripts/delete-non-staff.mjs apply the same Google Play protection as the hard-delete route:
// refuse a member whose paid Play entitlement is still running, and ANONYMISE (not delete) the purchase records of members who
// are deleted. Isolated temp db file (GYM_DB_PATH). Fake tokens and ids only. Never data/db.json.
import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const MEMBERS = path.resolve(process.cwd(), "scripts/delete-members.mjs");
const NON_STAFF = path.resolve(process.cwd(), "scripts/delete-non-staff.mjs");
const DAY = 86_400_000;

let dir: string;
let dbPath: string;

const purchase = (userId: string, token: string, over: Record<string, unknown> = {}) => ({
  id: `p-${userId}`,
  userId,
  purchaseToken: token,
  productId: "app_subscription",
  status: "active",
  expiryTimeMillis: Date.now() + 30 * DAY,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const fixture = () => ({
  users: [
    { id: "staff-1", email: "staff@x.test", role: "admin_manager" },
    { id: "m-active", email: "active@x.test", role: "member" },
    { id: "m-graceful", email: "cancelled-paid@x.test", role: "member" },
    { id: "m-ended", email: "ended@x.test", role: "member" },
    { id: "m-plain", email: "plain@x.test", role: "member" },
  ],
  googlePlayPurchases: [
    purchase("m-active", "fake-token-active"),
    purchase("m-graceful", "fake-token-graceful", { status: "canceled", expiryTimeMillis: Date.now() + 5 * DAY }),
    purchase("m-ended", "fake-token-ended", { status: "expired", expiryTimeMillis: Date.now() - DAY }),
  ],
  subscriptions: [],
  profiles: [{ userId: "m-plain" }, { userId: "m-active" }, { userId: "m-ended" }],
});

const run = (script: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [script, ...args], { env: { ...process.env, GYM_DB_PATH: dbPath }, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const readDb = () => JSON.parse(readFileSync(dbPath, "utf8"));
const ids = () => readDb().users.map((u: { id: string }) => u.id).sort();

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "delete-play-"));
  dbPath = path.join(dir, "db.json");
  writeFileSync(dbPath, JSON.stringify(fixture(), null, 2));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe.each([
  ["delete-non-staff", NON_STAFF, [] as string[]],
  ["delete-members", MEMBERS, ["active@x.test", "cancelled-paid@x.test", "ended@x.test", "plain@x.test"]],
])("%s", (_name, script, targets) => {
  it("dry run changes nothing and names the refused members without printing a token or id", () => {
    const before = readFileSync(dbPath, "utf8");
    const r = run(script, ...targets);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Refused \(active Google Play subscription, nothing deleted\): active@x\.test, cancelled-paid@x\.test/);
    expect(r.out).not.toMatch(/fake-token|p-m-/);
    expect(readFileSync(dbPath, "utf8")).toBe(before);
  });

  it("--confirm refuses running Play entitlements, deletes the rest, and anonymises ended purchases instead of deleting them", () => {
    const r = run(script, ...targets, "--confirm");
    expect(r.code).toBe(0);
    const db = readDb();
    // Refused members and staff remain; ended and plain members are gone.
    expect(ids()).toEqual(["m-active", "m-graceful", "staff-1"]);
    // The running entitlements' purchase records are untouched.
    expect(db.googlePlayPurchases.find((p: { purchaseToken: string }) => p.purchaseToken === "fake-token-active")).toMatchObject({ userId: "m-active", status: "active" });
    expect(db.googlePlayPurchases.find((p: { purchaseToken: string }) => p.purchaseToken === "fake-token-graceful")).toMatchObject({ userId: "m-graceful" });
    // The ended purchase is kept, anonymised, with its token.
    const ended = db.googlePlayPurchases.find((p: { purchaseToken: string }) => p.purchaseToken === "fake-token-ended");
    expect(ended.userId).toMatch(/^deleted:[0-9a-f]{16}$/);
    expect(ended).toMatchObject({ status: "expired", anonymizedAt: expect.any(String) });
    expect(db.googlePlayPurchases).toHaveLength(3);
    // Owned records of the deleted members go; a refused member's other records stay.
    expect(db.profiles.map((p: { userId: string }) => p.userId)).toEqual(["m-active"]);
    expect(readdirSync(dir).filter((f) => f.includes(".bak-"))).toHaveLength(1);
  });

  it("is idempotent: a second --confirm changes nothing", () => {
    run(script, ...targets, "--confirm");
    const once = readFileSync(dbPath, "utf8");
    run(script, ...targets, "--confirm");
    expect(readFileSync(dbPath, "utf8")).toBe(once);
  });

  it("the anonymised owner id matches the one the app computes (so the token stays owned by a stable tombstone)", async () => {
    run(script, ...targets, "--confirm");
    const { deletedOwnerId } = await import("@/lib/member-deletion-guard");
    const ended = readDb().googlePlayPurchases.find((p: { purchaseToken: string }) => p.purchaseToken === "fake-token-ended");
    expect(ended.userId).toBe(deletedOwnerId("m-ended"));
  });
});
