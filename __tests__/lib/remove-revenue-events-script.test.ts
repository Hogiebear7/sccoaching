// scripts/remove-revenue-events.mjs — the only way to remove webhook-recorded
// revenue events (there is no route or UI). Runs against an ISOLATED temp db
// file (GYM_DB_PATH), never the real data/db.json.
//   * --list is read-only and never prints user ids
//   * removal needs explicit --ref values and a matching --expect-total-cents
//   * dry run by default; --confirm removes only the named events, with a backup
//   * any unknown, ambiguous, or purchase reference aborts with nothing written
import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(process.cwd(), "scripts/remove-revenue-events.mjs");

let dir: string;
let dbPath: string;
const ev = (id: string, ref: string, amountCents: number, receivedAt: string) => ({
  id,
  userId: "secret-user-id",
  packageId: null,
  billingOptionId: null,
  amountCents,
  currency: "eur",
  provider: "stripe",
  providerRef: ref,
  source: "membership_renewal",
  receivedAt,
});
const events = [
  ev("e1", "in_test1", 57000, "2026-08-06T10:00:00.000Z"),
  ev("e2", "in_test2", 30000, "2026-08-05T10:00:00.000Z"),
  ev("e3", "in_test3", 330000, "2026-08-05T11:00:00.000Z"),
  ev("e4", "in_real", 5000, "2026-09-01T09:00:00.000Z"),
  ev("e5", "in_dup", 100, "2026-09-02T09:00:00.000Z"),
  ev("e6", "in_dup", 100, "2026-09-02T09:00:00.000Z"),
];
const purchases = [{ id: "p1", providerPaymentRef: "pi_purchase", providerOrderId: "cs_purchase" }];

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, GYM_DB_PATH: dbPath }, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const readDb = () => JSON.parse(readFileSync(dbPath, "utf8"));
const ids = () => readDb().revenueEvents.map((e: { id: string }) => e.id);
const backups = () => readdirSync(dir).filter((f) => f.includes(".bak-"));

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "rm-rev-"));
  dbPath = path.join(dir, "db.json");
  writeFileSync(dbPath, JSON.stringify({ users: [{ id: "secret-user-id" }], revenueEvents: structuredClone(events), purchases }, null, 2));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("remove-revenue-events script", () => {
  it("--list is read-only, filters by date window, and never prints a user id", () => {
    const before = readFileSync(dbPath, "utf8");

    const r = run("--list", "--from", "2026-08-05", "--to", "2026-08-06");

    expect(r.code).toBe(0);
    expect(r.out).toMatch(/in_test1/);
    expect(r.out).toMatch(/in_test3/);
    expect(r.out).not.toMatch(/in_real/);
    expect(r.out).toMatch(/Total: 4170\.00/);
    expect(r.out).not.toMatch(/secret-user-id/);
    expect(readFileSync(dbPath, "utf8")).toBe(before);
    expect(backups()).toHaveLength(0);
  });

  it("is a dry run by default: shows what would go, writes nothing, makes no backup", () => {
    const before = readFileSync(dbPath, "utf8");

    const r = run("--ref", "in_test1", "--ref", "in_test2", "--ref", "in_test3", "--expect-total-cents", "417000");

    expect(r.code).toBe(0);
    expect(r.out).toMatch(/DRY RUN/);
    expect(r.out).toMatch(/3 events, total 4170\.00/);
    expect(readFileSync(dbPath, "utf8")).toBe(before);
    expect(backups()).toHaveLength(0);
  });

  it("--confirm removes exactly the named events, keeps everything else, and writes a backup", () => {
    const r = run("--ref", "in_test1", "--ref", "in_test2", "--ref", "in_test3", "--expect-total-cents", "417000", "--confirm");

    expect(r.code).toBe(0);
    expect(ids()).toEqual(["e4", "e5", "e6"]);
    expect(readDb().purchases).toEqual(purchases);
    expect(readDb().users).toEqual([{ id: "secret-user-id" }]);
    expect(backups()).toHaveLength(1);
    expect(r.out).not.toMatch(/secret-user-id/);
  });

  it.each([
    ["no --ref", ["--expect-total-cents", "1"], /Provide one or more --ref/],
    ["a missing --expect-total-cents", ["--ref", "in_test1"], /--expect-total-cents/],
    ["a non-numeric --expect-total-cents", ["--ref", "in_test1", "--expect-total-cents", "57.00"], /--expect-total-cents/],
    ["a total that does not match", ["--ref", "in_test1", "--expect-total-cents", "1"], /Nothing removed/],
    ["an unknown reference", ["--ref", "in_nope", "--expect-total-cents", "1"], /No revenue event has reference/],
    ["an ambiguous reference", ["--ref", "in_dup", "--expect-total-cents", "100"], /refusing to guess/],
    ["a pass purchase reference", ["--ref", "pi_purchase", "--expect-total-cents", "1"], /pass purchase/],
    ["a duplicate --ref", ["--ref", "in_test1", "--ref", "in_test1", "--expect-total-cents", "114000"], /Duplicate/],
    ["an unknown argument", ["--ref", "in_test1", "--all"], /Unknown argument/],
    ["--list combined with --confirm", ["--list", "--confirm"], /read-only/],
  ])("aborts for %s, changing nothing even with --confirm", (_label, args, message) => {
    const before = readFileSync(dbPath, "utf8");

    const r = run(...(args as string[]), "--confirm");

    expect(r.code).toBe(1);
    expect(r.out).toMatch(message);
    expect(readFileSync(dbPath, "utf8")).toBe(before);
    expect(backups()).toHaveLength(0);
  });

  it("one bad ref among good ones aborts the whole run", () => {
    const before = readFileSync(dbPath, "utf8");

    const r = run("--ref", "in_test1", "--ref", "in_nope", "--expect-total-cents", "57000", "--confirm");

    expect(r.code).toBe(1);
    expect(readFileSync(dbPath, "utf8")).toBe(before);
  });
});
