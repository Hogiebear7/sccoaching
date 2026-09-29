// scripts/backfill-subscription-owner-gym.mjs — backfills
// SubscriptionRecord.ownerGym onto subscription rows written before that
// field existed. Runs against an ISOLATED temp db file (GYM_DB_PATH), never
// the real data/db.json.
//   * ownership is derived only from packageId -> package -> category/
//     global-exception — never the user's current gym (immutability)
//   * a legacy/removed-product or packageId-less subscription is left
//     "unresolved" — never guessed
//   * already-migrated rows (ownerGym already set) are never touched again
//   * --report is read-only; dry run by default; --confirm backs up first
import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(process.cwd(), "scripts/backfill-subscription-owner-gym.mjs");

let dir: string;
let dbPath: string;

// Two synthetic gyms, separate users.
const GYM_A = "gym-a";
const GYM_B = "gym-b";

const fixture = () => ({
  membershipCategories: [
    { id: "cat-a", gymId: GYM_A },
    { id: "cat-b", gymId: GYM_B },
  ],
  membershipPackages: [
    { id: "pkg-a", categoryId: "cat-a", deliveryChannel: "gym_only" },
    { id: "pkg-b", categoryId: "cat-b", deliveryChannel: "gym_only" },
    { id: "pkg-global", categoryId: "cat-a", deliveryChannel: "app_only" },
  ],
  subscriptions: [
    { userId: "user-a", packageId: "pkg-a", status: "active" },
    { userId: "user-global", packageId: "pkg-global", status: "active" },
    { userId: "user-legacy", packageId: "removed-product", status: "active" },
    { userId: "user-no-package", packageId: null, status: "canceled" },
    { userId: "user-already", packageId: "pkg-a", status: "active", ownerGym: { scope: "gym", gymId: GYM_B } },
  ],
});

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, GYM_DB_PATH: dbPath }, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const readDb = () => JSON.parse(readFileSync(dbPath, "utf8"));
const backups = () => readdirSync(dir).filter((f) => f.includes(".bak-"));
const subById = (userId: string) => readDb().subscriptions.find((s: { userId: string }) => s.userId === userId);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "backfill-sub-owner-gym-"));
  dbPath = path.join(dir, "db.json");
  writeFileSync(dbPath, JSON.stringify(fixture(), null, 2));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("backfill-subscription-owner-gym script", () => {
  it("--report is read-only and writes nothing", () => {
    const before = readFileSync(dbPath, "utf8");
    const r = run("--report");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Nothing written/);
    expect(readFileSync(dbPath, "utf8")).toBe(before);
    expect(backups()).toHaveLength(0);
  });

  it("is a dry run by default: reports counts, writes nothing, makes no backup", () => {
    const before = readFileSync(dbPath, "utf8");
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/DRY RUN/);
    expect(readFileSync(dbPath, "utf8")).toBe(before);
    expect(backups()).toHaveLength(0);
  });

  it("derives a gym-scoped subscription from its package's category", () => {
    run("--confirm");
    expect(subById("user-a").ownerGym).toEqual({ scope: "gym", gymId: GYM_A });
  });

  it("derives platform scope for the global App Subscription package", () => {
    run("--confirm");
    expect(subById("user-global").ownerGym).toEqual({ scope: "platform" });
  });

  it("leaves a legacy/removed-product subscription unresolved rather than guessing", () => {
    run("--confirm");
    expect(subById("user-legacy").ownerGym).toEqual({ scope: "unresolved" });
  });

  it("leaves a packageId-less subscription unresolved — never falls back to the user's current gym", () => {
    run("--confirm");
    expect(subById("user-no-package").ownerGym).toEqual({ scope: "unresolved" });
  });

  it("never touches an already-migrated subscription", () => {
    run("--confirm");
    // Stays GYM_B even though packageId (pkg-a) would resolve to GYM_A —
    // proof the script skips it rather than re-deriving.
    expect(subById("user-already").ownerGym).toEqual({ scope: "gym", gymId: GYM_B });
  });

  it("--confirm writes exactly one backup of the pre-migration state", () => {
    const before = readFileSync(dbPath, "utf8");
    const r = run("--confirm");
    expect(r.code).toBe(0);
    expect(backups()).toHaveLength(1);
    expect(readFileSync(path.join(dir, backups()[0]), "utf8")).toBe(before);
  });

  it("is idempotent — a second --confirm run changes nothing further", () => {
    run("--confirm");
    const afterFirst = readFileSync(dbPath, "utf8");
    const r = run("--confirm");
    expect(r.code).toBe(0);
    expect(readFileSync(dbPath, "utf8")).toBe(afterFirst);
    // A second --confirm still makes its own backup even though nothing
    // substantive changed.
    expect(backups()).toHaveLength(2);
  });

  it("rejects --report combined with --confirm", () => {
    const before = readFileSync(dbPath, "utf8");
    const r = run("--report", "--confirm");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/read-only/);
    expect(readFileSync(dbPath, "utf8")).toBe(before);
  });

  it("rejects an unknown argument", () => {
    const r = run("--bogus");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Unknown argument/);
  });

  it("--report never prints a user id or email", () => {
    const r = run("--report");
    expect(r.out).not.toMatch(/user-a|user-global|user-legacy/);
  });
});
