// scripts/promote-platform-operator.mjs — the ONLY way the platform_operator role
// is granted. It runs against an ISOLATED temp db file (GYM_DB_PATH), never the
// real data/db.json, so nothing here touches real or production data.
//   * dry run by default; --confirm applies and writes a backup
//   * exactly one of --user-id / --email; no hardcoded identity, no default target
//   * fails clearly when the user is missing, ambiguous, archived, or not an
//     existing staff account; leaves an existing operator unchanged
//   * changes only that one user's role (+ updatedAt); gymId is untouched, and a
//     null gymId alone never promotes anyone
import { spawnSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(process.cwd(), "scripts/promote-platform-operator.mjs");

let dir: string;
let dbPath: string;
const users = [
  { id: "u-admin", email: "owner@sc.test", role: "admin_manager", gymId: null, archivedAt: null, passwordHash: "salt:hash" },
  { id: "u-coach", email: "coach@sc.test", role: "coach", gymId: null, archivedAt: null, passwordHash: "salt:hash" },
  { id: "u-member", email: "member@sc.test", role: "member", gymId: null, archivedAt: null, passwordHash: "salt:hash" },
  { id: "u-archived", email: "old@sc.test", role: "admin", gymId: null, archivedAt: "2026-01-01T00:00:00.000Z", passwordHash: "salt:hash" },
  { id: "u-gymb", email: "owner@gymb.test", role: "admin_manager", gymId: "gym-b", archivedAt: null, passwordHash: "salt:hash" },
  { id: "u-dup-1", email: "dup@sc.test", role: "admin", gymId: null, archivedAt: null, passwordHash: "salt:hash" },
  { id: "u-dup-2", email: "DUP@sc.test", role: "coach", gymId: null, archivedAt: null, passwordHash: "salt:hash" },
  { id: "u-op", email: "op@sc.test", role: "platform_operator", gymId: null, archivedAt: null, passwordHash: "salt:hash" },
];

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, GYM_DB_PATH: dbPath }, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const readDb = () => JSON.parse(readFileSync(dbPath, "utf8"));
const roleOf = (id: string) => readDb().users.find((u: { id: string }) => u.id === id).role;
const backups = () => readdirSync(dir).filter((f) => f.includes(".bak-"));

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "promote-op-"));
  dbPath = path.join(dir, "db.json");
  writeFileSync(dbPath, JSON.stringify({ users: structuredClone(users), gyms: [] }, null, 2));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("promote-platform-operator script", () => {
  it("is a dry run by default: reports the change, writes nothing, makes no backup", () => {
    const before = readFileSync(dbPath, "utf8");

    const r = run("--user-id", "u-admin");

    expect(r.code).toBe(0);
    expect(r.out).toMatch(/DRY RUN/);
    expect(r.out).toMatch(/admin_manager -> platform_operator/);
    expect(readFileSync(dbPath, "utf8")).toBe(before);
    expect(backups()).toHaveLength(0);
  });

  it("--confirm promotes exactly the named account, writes a backup, and touches nothing else (gymId unchanged)", () => {
    const r = run("--user-id", "u-admin", "--confirm");

    expect(r.code).toBe(0);
    expect(roleOf("u-admin")).toBe("platform_operator");
    expect(readDb().users.find((u: { id: string }) => u.id === "u-admin").gymId).toBeNull();
    for (const other of users.filter((u) => u.id !== "u-admin")) expect(roleOf(other.id)).toBe(other.role);
    expect(backups()).toHaveLength(1);
    expect(r.out).not.toMatch(/salt:hash/); // never prints hashes
  });

  it("can target by email (case-insensitive) and can promote a staff account that belongs to another gym", () => {
    expect(run("--email", "OWNER@GYMB.TEST", "--confirm").code).toBe(0);
    expect(roleOf("u-gymb")).toBe("platform_operator");
    expect(readDb().users.find((u: { id: string }) => u.id === "u-gymb").gymId).toBe("gym-b");
  });

  it("requires exactly one explicit identifier: none, or both, is refused and nothing changes", () => {
    const before = readFileSync(dbPath, "utf8");

    expect(run().code).toBe(1);
    expect(run("--confirm").code).toBe(1);
    const both = run("--user-id", "u-admin", "--email", "owner@sc.test", "--confirm");
    expect(both.code).toBe(1);
    expect(both.out).toMatch(/exactly one/i);
    expect(readFileSync(dbPath, "utf8")).toBe(before);
  });

  it("gymId: null alone never promotes anyone: with no target, no account is chosen", () => {
    run("--confirm");

    for (const u of users) expect(roleOf(u.id)).toBe(u.role);
  });

  it.each([
    ["a missing user id", ["--user-id", "nope"], /No account matches/],
    ["a missing email", ["--email", "nobody@x.test"], /No account matches/],
    ["an ambiguous email (two accounts match)", ["--email", "dup@sc.test"], /refusing to guess/],
    ["an archived account", ["--user-id", "u-archived"], /archived/],
    ["a member account", ["--user-id", "u-member"], /Only an existing staff account/],
    ["an unknown argument", ["--user-id", "u-admin", "--everyone"], /Unknown argument/],
  ])("fails clearly for %s, changing nothing even with --confirm", (_label, args, message) => {
    const before = readFileSync(dbPath, "utf8");

    const r = run(...(args as string[]), "--confirm");

    expect(r.code).toBe(1);
    expect(r.out).toMatch(message);
    expect(readFileSync(dbPath, "utf8")).toBe(before);
    expect(backups()).toHaveLength(0);
  });

  it("leaves an existing operator unchanged (idempotent)", () => {
    const before = readFileSync(dbPath, "utf8");

    const r = run("--user-id", "u-op", "--confirm");

    expect(r.code).toBe(0);
    expect(r.out).toMatch(/already a platform_operator/);
    expect(readFileSync(dbPath, "utf8")).toBe(before);
    expect(backups()).toHaveLength(0);
  });

  it("fails clearly when the database file does not exist", () => {
    rmSync(dbPath);

    const r = run("--user-id", "u-admin", "--confirm");

    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Database not found/);
    expect(existsSync(dbPath)).toBe(false);
  });
});
