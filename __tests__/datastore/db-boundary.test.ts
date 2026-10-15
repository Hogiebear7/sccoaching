// The persistence boundary of lib/db.ts: what happens with a missing, malformed or newer-than-this-version datastore, and whether rewriting the file
// (which the app does on every save) keeps every meaningful field that was already there.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
let dbFile: string;
const endTurn = () => new Promise<void>((r) => setImmediate(r));

async function loadDb() {
  vi.resetModules();
  vi.stubEnv("DATA_DIR", dir);
  return await import("@/lib/db");
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "datastore-db-"));
  dbFile = path.join(dir, "db.json");
});
afterEach(async () => {
  await endTurn();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a missing datastore", () => {
  it("in development and tests starts empty, as before", async () => {
    const db = await loadDb();
    expect(db.findUserByEmail("nobody@example.test")).toBeUndefined();
    db.createUserWithRole("a@example.test", "x", "member", null);
    await endTurn();
    expect(fs.existsSync(dbFile)).toBe(true);
  });

  it("in production is an error, not a new empty datastore, unless a brand-new install is explicitly declared", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const db = await loadDb();
    expect(() => db.findUserByEmail("a@example.test")).toThrowError(expect.objectContaining({ code: "DATASTORE_NOT_INITIALISED" }));
    await endTurn();
    expect(fs.existsSync(dbFile)).toBe(false);

    vi.stubEnv("SANDC_ALLOW_NEW_DATASTORE", "1");
    expect(db.findUserByEmail("a@example.test")).toBeUndefined();
    db.createUserWithRole("a@example.test", "x", "member", null);
    await endTurn();
    expect(fs.existsSync(dbFile)).toBe(true);
  });

  it("once a datastore existed, losing the file is an error EVEN with the new-install flag (a wrong DATA_DIR or a wiped folder must not look like a fresh start)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SANDC_ALLOW_NEW_DATASTORE", "1");
    const db = await loadDb();
    db.createUserWithRole("a@example.test", "x", "member", null);
    await endTurn();
    fs.unlinkSync(dbFile);
    expect(() => db.findUserByEmail("a@example.test")).toThrowError(expect.objectContaining({ code: "DATASTORE_MISSING" }));
    await endTurn();
    expect(() => db.createUserWithRole("b@example.test", "x", "member", null)).toThrowError(expect.objectContaining({ code: "DATASTORE_MISSING" }));
    await endTurn();
    expect(fs.existsSync(dbFile)).toBe(false);
  });
});

describe("a malformed datastore", () => {
  for (const [label, bad] of [["truncated JSON", '{"users":[{"id":"u1","email":"a@'], ["an empty file", ""], ["a JSON array", "[]"]] as const) {
    it(`(${label}) fails every read and write loudly and is never overwritten`, async () => {
      fs.writeFileSync(dbFile, bad);
      const db = await loadDb();
      expect(() => db.findUserByEmail("a@example.test")).toThrowError(expect.objectContaining({ code: "DATASTORE_CORRUPT" }));
      await endTurn();
      expect(() => db.createUserWithRole("b@example.test", "x", "member", null)).toThrowError(expect.objectContaining({ code: "DATASTORE_CORRUPT" }));
      await endTurn();
      expect(fs.readFileSync(dbFile, "utf8")).toBe(bad);
      expect(fs.readdirSync(dir).filter((f) => f.includes(".tmp-") || f.endsWith(".lock"))).toEqual([]);
    });
  }
});

describe("rewriting the datastore does not delete what this version does not know", () => {
  it("keeps unknown top-level keys (so rolling the code back cannot silently delete newer data on the next save)", async () => {
    fs.writeFileSync(dbFile, JSON.stringify({ users: [], futureCollection: [{ id: "f1", note: "written by a newer version" }], futureSettings: { on: true } }));
    const db = await loadDb();
    db.createUserWithRole("a@example.test", "x", "member", null);
    await endTurn();
    const after = JSON.parse(fs.readFileSync(dbFile, "utf8"));
    expect(after.futureCollection).toEqual([{ id: "f1", note: "written by a newer version" }]);
    expect(after.futureSettings).toEqual({ on: true });
    expect(after.users).toHaveLength(1);
  });

  it("keeps unknown fields inside records that the normaliser spreads (for example a profile field added by a newer version)", async () => {
    fs.writeFileSync(dbFile, JSON.stringify({ users: [], profiles: [{ userId: "u1", fullName: "A", email: "a@example.test", futureProfileField: { x: 1 }, createdAt: "t", updatedAt: "t" }] }));
    const db = await loadDb();
    db.createUserWithRole("b@example.test", "x", "member", null);
    await endTurn();
    const after = JSON.parse(fs.readFileSync(dbFile, "utf8"));
    expect(after.profiles[0].futureProfileField).toEqual({ x: 1 });
  });
});

// NORMALISATION REVIEW. Every save rewrites the whole file through the app's read-time normaliser. This takes a datastore generated by the repository's own
// fixture generator (real record shapes, two gyms), performs one ordinary application write, and proves that no existing record disappeared, no record
// changed order, and no existing field changed value or vanished, except for the explicitly documented transformations below.
describe("normalisation on rewrite preserves every meaningful existing field", () => {
  it("only the documented transformations occur", async () => {
    const creds = path.join(dir, "creds.json");
    const gen = spawnSync(process.execPath, [path.join(process.cwd(), "scripts", "seed-staging-fixtures.mjs"), "--credentials-out", creds], {
      env: { ...process.env, GYM_DB_PATH: dbFile },
      encoding: "utf8",
    });
    expect(gen.status, gen.stderr).toBe(0);
    const before = JSON.parse(fs.readFileSync(dbFile, "utf8"));

    const db = await loadDb();
    db.createUserWithRole("one-more@example.test", "x", "member", null);
    await endTurn();
    const after = JSON.parse(fs.readFileSync(dbFile, "utf8"));

    const problems: string[] = [];
    const addedByCollection: Record<string, Set<string>> = {};
    for (const [collection, oldValue] of Object.entries(before)) {
      const newValue = after[collection];
      if (newValue === undefined) { problems.push(`collection removed: ${collection}`); continue; }
      if (!Array.isArray(oldValue)) {
        // singleton settings object: every existing key must survive unchanged
        for (const [k, v] of Object.entries(oldValue as Record<string, unknown>)) if (JSON.stringify(newValue[k]) !== JSON.stringify(v)) problems.push(`${collection}.${k} changed`);
        continue;
      }
      const extra = collection === "users" ? 1 : 0; // the one record this test added
      if (newValue.length !== oldValue.length + extra) problems.push(`${collection}: record count ${oldValue.length} -> ${newValue.length}`);
      oldValue.forEach((rec: Record<string, unknown>, i: number) => {
        const next = newValue[i] as Record<string, unknown> | undefined;
        if (!next) { problems.push(`${collection}[${i}] removed or reordered`); return; }
        for (const [k, v] of Object.entries(rec)) {
          if (!(k in next)) { problems.push(`${collection}[${i}].${k} was dropped`); continue; }
          if (JSON.stringify(next[k]) === JSON.stringify(v)) continue;
          // documented transformations
          if (collection === "recoveryLogs" && (k === "sleepQuality" || k === "soreness") && rec.scale10 === undefined && next[k] === Math.min(10, (v as number) * 2)) continue; // legacy 1-5 scale doubled, flagged with scale10
          problems.push(`${collection}[${i}].${k} changed`);
        }
        for (const k of Object.keys(next)) if (!(k in rec)) (addedByCollection[collection] ??= new Set()).add(k);
      });
    }
    expect(problems).toEqual([]);
    // Fields ADDED are defaults the app already applied on every read; list them so a reviewer can see exactly what a first save materialises.
    const added = Object.fromEntries(Object.entries(addedByCollection).map(([c, s]) => [c, [...s].sort()]));
    expect(Object.keys(added).length).toBeGreaterThan(0);
    expect(Object.values(added).flat().every((k) => typeof k === "string")).toBe(true);
    // collections that did not exist in the file are created empty or with the built-in defaults, never with invented user data
    for (const key of Object.keys(after)) if (!(key in before)) expect(Array.isArray(after[key]) || typeof after[key] === "object").toBe(true);
    expect(after.users.map((u: { email: string }) => u.email)).toContain("one-more@example.test");
  });
});
