// scripts/backfill-revenue-event-owner-gym.mjs — backfills
// RevenueEventRecord.ownerGym onto revenue-event rows written before that
// field existed. Runs against an ISOLATED temp db file (GYM_DB_PATH), never
// the real data/db.json.
//   * a revenue event is NEVER linked to a PurchaseRecord — only to the
//     paying member's SubscriptionRecord (matched by userId), mirroring
//     every write site's own derivation exactly
//   * provider "google_play" is always platform scope — no lookup needed
//   * a user with no subscription row, or a subscription row that predates
//     ownerGym, is left "unresolved" — never guessed
//   * already-migrated rows (ownerGym already set) are never touched again
//   * --report is read-only; dry run by default; --confirm backs up first
import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(process.cwd(), "scripts/backfill-revenue-event-owner-gym.mjs");

let dir: string;
let dbPath: string;

const GYM_A = "gym-a";
const GYM_B = "gym-b";

const fixture = () => ({
  subscriptions: [
    { userId: "user-a", packageId: "pkg-a", status: "active", ownerGym: { scope: "gym", gymId: GYM_A } },
    { userId: "user-b", packageId: "pkg-b", status: "active", ownerGym: { scope: "gym", gymId: GYM_B } },
    { userId: "user-platform", packageId: "pkg-app", status: "active", ownerGym: { scope: "platform" } },
    { userId: "user-legacy-sub", packageId: "pkg-a", status: "active" }, // predates ownerGym
  ],
  revenueEvents: [
    { id: "rev-a", userId: "user-a", provider: "stripe", providerRef: "in_a", amountCents: 2500, currency: "eur", source: "membership_renewal", receivedAt: "2026-01-01T00:00:00.000Z" },
    { id: "rev-b", userId: "user-b", provider: "revolut", providerRef: "ord_b", amountCents: 2500, currency: "eur", source: "membership_renewal", receivedAt: "2026-01-01T00:00:00.000Z" },
    { id: "rev-platform-stripe", userId: "user-platform", provider: "stripe", providerRef: "in_p", amountCents: 999, currency: "eur", source: "membership_renewal", receivedAt: "2026-01-01T00:00:00.000Z" },
    { id: "rev-gplay", userId: "user-a", provider: "google_play", providerRef: "GPA.1", amountCents: 999, currency: "eur", source: "membership_renewal", receivedAt: "2026-01-01T00:00:00.000Z" },
    { id: "rev-no-sub", userId: "user-deleted", provider: "stripe", providerRef: "in_gone", amountCents: 2500, currency: "eur", source: "membership_renewal", receivedAt: "2026-01-01T00:00:00.000Z" },
    { id: "rev-legacy-sub", userId: "user-legacy-sub", provider: "revolut", providerRef: "ord_legacy", amountCents: 2500, currency: "eur", source: "membership_renewal", receivedAt: "2026-01-01T00:00:00.000Z" },
    { id: "rev-already", userId: "user-a", provider: "stripe", providerRef: "in_already", amountCents: 2500, currency: "eur", source: "membership_renewal", receivedAt: "2026-01-01T00:00:00.000Z", ownerGym: { scope: "gym", gymId: GYM_B } },
  ],
});

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, GYM_DB_PATH: dbPath }, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const readDb = () => JSON.parse(readFileSync(dbPath, "utf8"));
const backups = () => readdirSync(dir).filter((f) => f.includes(".bak-"));
const eventById = (id: string) => readDb().revenueEvents.find((e: { id: string }) => e.id === id);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "backfill-revenue-gym-"));
  dbPath = path.join(dir, "db.json");
  writeFileSync(dbPath, JSON.stringify(fixture(), null, 2));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("backfill-revenue-event-owner-gym script", () => {
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

  it("derives a gym-owned revenue event from its linked subscription's own ownerGym", () => {
    run("--confirm");
    expect(eventById("rev-a").ownerGym).toEqual({ scope: "gym", gymId: GYM_A });
  });

  it("derives a different gym's revenue event independently", () => {
    run("--confirm");
    expect(eventById("rev-b").ownerGym).toEqual({ scope: "gym", gymId: GYM_B });
  });

  it("derives platform scope for a Stripe/Revolut event linked to a platform-scoped subscription", () => {
    run("--confirm");
    expect(eventById("rev-platform-stripe").ownerGym).toEqual({ scope: "platform" });
  });

  it("derives platform scope for a Google Play event unconditionally, without a subscription lookup", () => {
    run("--confirm");
    expect(eventById("rev-gplay").ownerGym).toEqual({ scope: "platform" });
  });

  it("leaves a revenue event unresolved when its user has no subscription row at all", () => {
    run("--confirm");
    expect(eventById("rev-no-sub").ownerGym).toEqual({ scope: "unresolved" });
  });

  it("leaves a revenue event unresolved when its linked subscription predates ownerGym — never falls back to the primary gym", () => {
    run("--confirm");
    expect(eventById("rev-legacy-sub").ownerGym).toEqual({ scope: "unresolved" });
  });

  it("never touches an already-migrated revenue event", () => {
    run("--confirm");
    // Stays GYM_B even though its linked subscription (user-a) is gym-a —
    // proof the script skips it rather than re-deriving.
    expect(eventById("rev-already").ownerGym).toEqual({ scope: "gym", gymId: GYM_B });
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

  it("--report never prints an event id, payment id, or user id", () => {
    const r = run("--report");
    expect(r.out).not.toMatch(/rev-a|user-a|in_a|GPA\.1/);
  });
});
