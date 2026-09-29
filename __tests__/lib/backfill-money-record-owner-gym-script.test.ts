// scripts/backfill-money-record-owner-gym.mjs — backfills MoneyRecordOwnerGym
// onto money records written before that field existed. Runs against an
// ISOLATED temp db file (GYM_DB_PATH), never the real data/db.json.
//   * ownership is derived only from authoritative existing relationships
//     (package/category, or the acting user's own current gym) — never a
//     client-supplied or guessed value
//   * paymentEvents are always left "unresolved" (pure audit rows — see the
//     script's own header comment for why replaying their gym is refused)
//   * a memberless finance entry is "unresolved" unless the owner opts in
//     with --finance-unresolved-to-platform
//   * already-migrated rows (ownerGym already set) are never touched again
//   * --report is read-only; dry run by default; --confirm backs up first
import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(process.cwd(), "scripts/backfill-money-record-owner-gym.mjs");

let dir: string;
let dbPath: string;

// Two synthetic gyms, separate users — exactly what the task asks for.
const GYM_A = "gym-a";
const GYM_B = "gym-b";

const fixture = () => ({
  users: [
    { id: "user-a", gymId: GYM_A },
    { id: "user-b", gymId: GYM_B },
    { id: "user-primary", gymId: null },
  ],
  membershipCategories: [
    { id: "cat-a", gymId: GYM_A },
    { id: "cat-b", gymId: GYM_B },
  ],
  membershipPackages: [
    { id: "pkg-a", categoryId: "cat-a", deliveryChannel: "gym_only" },
    { id: "pkg-b", categoryId: "cat-b", deliveryChannel: "gym_only" },
    { id: "pkg-global", categoryId: "cat-a", deliveryChannel: "app_only" },
  ],
  purchases: [
    { id: "pur-a", userId: "user-a", productId: "pkg-a" },
    { id: "pur-global", userId: "user-b", productId: "pkg-global" },
    { id: "pur-legacy", userId: "user-a", productId: "removed-product" },
    { id: "pur-already", userId: "user-a", productId: "pkg-a", ownerGym: { scope: "gym", gymId: GYM_B } },
  ],
  passLedger: [
    // purchase-provenance: inherits from the (now-migrated) purchase
    { id: "led-purchase", userId: "user-a", reason: "purchase", purchaseId: "pur-a", bookingId: null },
    // booking-provenance: derived from the acting user's own current gym
    { id: "led-consume", userId: "user-b", reason: "consume", purchaseId: null, bookingId: "bk-1" },
    // already migrated — must be left exactly as-is
    { id: "led-already", userId: "user-a", reason: "consume", purchaseId: null, bookingId: "bk-2", ownerGym: { scope: "platform" } },
  ],
  paymentEvents: [
    { key: "evt-1", provider: "stripe", type: "checkout.session.completed", entityId: "cs_1", receivedAt: "2026-01-01T00:00:00.000Z" },
    { key: "evt-already", provider: "stripe", type: "checkout.session.completed", entityId: "cs_2", receivedAt: "2026-01-01T00:00:00.000Z", ownerGym: { scope: "gym", gymId: GYM_A } },
  ],
  financeLedgerEntries: [
    { id: "fin-member", memberId: "user-b", kind: "income" },
    { id: "fin-noMember", memberId: null, kind: "expense" },
    { id: "fin-already", memberId: null, kind: "expense", ownerGym: { scope: "platform" } },
  ],
});

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, GYM_DB_PATH: dbPath }, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const readDb = () => JSON.parse(readFileSync(dbPath, "utf8"));
const backups = () => readdirSync(dir).filter((f) => f.includes(".bak-"));

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "backfill-owner-gym-"));
  dbPath = path.join(dir, "db.json");
  writeFileSync(dbPath, JSON.stringify(fixture(), null, 2));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("backfill-money-record-owner-gym script", () => {
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

  it("derives a gym-scoped purchase from its package's category", () => {
    run("--confirm");
    const purchase = readDb().purchases.find((p: { id: string }) => p.id === "pur-a");
    expect(purchase.ownerGym).toEqual({ scope: "gym", gymId: GYM_A });
  });

  it("derives platform scope for the global App Subscription package", () => {
    run("--confirm");
    const purchase = readDb().purchases.find((p: { id: string }) => p.id === "pur-global");
    expect(purchase.ownerGym).toEqual({ scope: "platform" });
  });

  it("leaves a legacy/removed-product purchase unresolved rather than guessing", () => {
    run("--confirm");
    const purchase = readDb().purchases.find((p: { id: string }) => p.id === "pur-legacy");
    expect(purchase.ownerGym).toEqual({ scope: "unresolved" });
  });

  it("never touches an already-migrated purchase", () => {
    run("--confirm");
    const purchase = readDb().purchases.find((p: { id: string }) => p.id === "pur-already");
    // Stays GYM_B even though productId (pkg-a) would resolve to GYM_A —
    // proof the script skips it rather than re-deriving.
    expect(purchase.ownerGym).toEqual({ scope: "gym", gymId: GYM_B });
  });

  it("a purchase-provenance pass-ledger entry inherits the migrated purchase's ownerGym", () => {
    run("--confirm");
    const entry = readDb().passLedger.find((e: { id: string }) => e.id === "led-purchase");
    expect(entry.ownerGym).toEqual({ scope: "gym", gymId: GYM_A });
  });

  it("a consume entry is derived from the acting user's own current gym", () => {
    run("--confirm");
    const entry = readDb().passLedger.find((e: { id: string }) => e.id === "led-consume");
    expect(entry.ownerGym).toEqual({ scope: "gym", gymId: GYM_B });
  });

  it("never touches an already-migrated pass-ledger entry", () => {
    run("--confirm");
    const entry = readDb().passLedger.find((e: { id: string }) => e.id === "led-already");
    expect(entry.ownerGym).toEqual({ scope: "platform" });
  });

  it("always marks paymentEvents unresolved — never replays which purchase/subscription produced them", () => {
    run("--confirm");
    const event = readDb().paymentEvents.find((e: { key: string }) => e.key === "evt-1");
    expect(event.ownerGym).toEqual({ scope: "unresolved" });
  });

  it("never touches an already-migrated paymentEvent", () => {
    run("--confirm");
    const event = readDb().paymentEvents.find((e: { key: string }) => e.key === "evt-already");
    expect(event.ownerGym).toEqual({ scope: "gym", gymId: GYM_A });
  });

  it("derives a member-linked finance entry from that member's own current gym", () => {
    run("--confirm");
    const entry = readDb().financeLedgerEntries.find((e: { id: string }) => e.id === "fin-member");
    expect(entry.ownerGym).toEqual({ scope: "gym", gymId: GYM_B });
  });

  it("leaves a memberless finance entry unresolved by default — never silently platform-wide", () => {
    run("--confirm");
    const entry = readDb().financeLedgerEntries.find((e: { id: string }) => e.id === "fin-noMember");
    expect(entry.ownerGym).toEqual({ scope: "unresolved" });
  });

  it("--finance-unresolved-to-platform is a separate, explicit opt-in for memberless entries", () => {
    run("--confirm", "--finance-unresolved-to-platform");
    const entry = readDb().financeLedgerEntries.find((e: { id: string }) => e.id === "fin-noMember");
    expect(entry.ownerGym).toEqual({ scope: "platform" });
  });

  it("never touches an already-migrated finance entry, even with --finance-unresolved-to-platform", () => {
    run("--confirm", "--finance-unresolved-to-platform");
    const entry = readDb().financeLedgerEntries.find((e: { id: string }) => e.id === "fin-already");
    expect(entry.ownerGym).toEqual({ scope: "platform" });
  });

  it("--confirm writes exactly one backup of the pre-migration state", () => {
    const before = readFileSync(dbPath, "utf8");
    const r = run("--confirm");
    expect(r.code).toBe(0);
    expect(backups()).toHaveLength(1);
    const backupContent = readFileSync(path.join(dir, backups()[0]), "utf8");
    expect(backupContent).toBe(before);
  });

  it("re-running after --confirm is idempotent — a second run changes nothing further", () => {
    run("--confirm");
    const afterFirst = readFileSync(dbPath, "utf8");
    const r = run("--confirm");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/0 already resolved|already set/i);
    expect(readFileSync(dbPath, "utf8")).toBe(afterFirst);
    // A second --confirm still makes its own backup (of the now-fully-migrated
    // state) even though nothing substantive changed.
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
});
