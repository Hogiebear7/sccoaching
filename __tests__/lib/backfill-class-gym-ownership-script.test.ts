// scripts/backfill-class-gym-ownership.mjs — backfills gymId onto
// ClassCategoryRecord/ClassRecord/ClassSeriesRecord rows written before that
// field existed. Runs against an ISOLATED temp db file (GYM_DB_PATH), never
// the real data/db.json.
//   * class/series ownership is derived only from coachUserId -> the coach's
//     own UserRecord.gymId — never guessed
//   * category ownership is derived from the set of distinct gyms among the
//     classes referencing its slug — exactly one -> that gym; none, or more
//     than one, -> unresolved, never guessed
//   * already-migrated rows (gymId already set, including an explicit null)
//     are never touched again
//   * --report is read-only; dry run by default; --confirm backs up first
import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(process.cwd(), "scripts/backfill-class-gym-ownership.mjs");

let dir: string;
let dbPath: string;

const GYM_A = "gym-a";
const GYM_B = "gym-b";

const fixture = () => ({
  users: [
    { id: "coach-a", gymId: GYM_A },
    { id: "coach-b", gymId: GYM_B },
    { id: "coach-primary", gymId: null },
  ],
  classCategories: [
    { id: "cat-only-a", slug: "only-a", name: "Only Gym A" },
    { id: "cat-shared", slug: "shared", name: "Shared" },
    { id: "cat-unused", slug: "unused", name: "Unused" },
    { id: "cat-already", slug: "already", name: "Already", gymId: GYM_B },
  ],
  classes: [
    { id: "cls-a1", category: "only-a", coachUserId: "coach-a" },
    { id: "cls-a2", category: "only-a", coachUserId: "coach-a" },
    { id: "cls-shared-a", category: "shared", coachUserId: "coach-a" },
    { id: "cls-shared-b", category: "shared", coachUserId: "coach-b" },
    { id: "cls-orphan", category: "gone", coachUserId: "coach-primary" },
    { id: "cls-no-coach", category: "only-a", coachUserId: "deleted-coach" },
    { id: "cls-already", category: "already", coachUserId: "coach-b", gymId: GYM_B },
  ],
  classSeries: [
    { id: "series-a", coachUserId: "coach-a" },
    { id: "series-no-coach", coachUserId: "deleted-coach" },
    { id: "series-already", coachUserId: "coach-a", gymId: null },
  ],
});

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, GYM_DB_PATH: dbPath }, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const readDb = () => JSON.parse(readFileSync(dbPath, "utf8"));
const backups = () => readdirSync(dir).filter((f) => f.includes(".bak-"));
const classById = (id: string) => readDb().classes.find((c: { id: string }) => c.id === id);
const seriesById = (id: string) => readDb().classSeries.find((s: { id: string }) => s.id === id);
const categoryBySlug = (slug: string) => readDb().classCategories.find((c: { slug: string }) => c.slug === slug);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "backfill-class-gym-"));
  dbPath = path.join(dir, "db.json");
  writeFileSync(dbPath, JSON.stringify(fixture(), null, 2));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("backfill-class-gym-ownership script", () => {
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

  it("derives a class's gym from its coach's own gymId", () => {
    run("--confirm");
    expect(classById("cls-a1").gymId).toBe(GYM_A);
    expect(classById("cls-shared-b").gymId).toBe(GYM_B);
  });

  it("derives the primary-gym (null) convention for a coach with no real gym", () => {
    run("--confirm");
    expect(classById("cls-orphan").gymId).toBeNull();
  });

  it("leaves a class unresolved when its coach account no longer exists", () => {
    run("--confirm");
    expect(classById("cls-no-coach").gymId).toBeUndefined();
  });

  it("derives a series's gym the same way as a class", () => {
    run("--confirm");
    expect(seriesById("series-a").gymId).toBe(GYM_A);
  });

  it("leaves a series unresolved when its coach account no longer exists", () => {
    run("--confirm");
    expect(seriesById("series-no-coach").gymId).toBeUndefined();
  });

  it("never touches an already-migrated class or series, even an explicit null", () => {
    run("--confirm");
    expect(classById("cls-already").gymId).toBe(GYM_B);
    expect(seriesById("series-already").gymId).toBeNull();
  });

  it("resolves a category to the one gym whose classes exclusively use its slug", () => {
    run("--confirm");
    expect(categoryBySlug("only-a").gymId).toBe(GYM_A);
  });

  it("leaves a category unresolved when classes using its slug span more than one gym", () => {
    run("--confirm");
    expect(categoryBySlug("shared").gymId).toBeUndefined();
  });

  it("leaves a category unresolved when no class references its slug", () => {
    run("--confirm");
    expect(categoryBySlug("unused").gymId).toBeUndefined();
  });

  it("never touches an already-migrated category", () => {
    run("--confirm");
    // Stays GYM_B even though its one referencing class (cls-already) is
    // ALSO gym-b — proof the script skips it rather than re-deriving, not a
    // coincidence of the fixture agreeing.
    expect(categoryBySlug("already").gymId).toBe(GYM_B);
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

  it("--report never prints a class, category, or coach identifier", () => {
    const r = run("--report");
    expect(r.out).not.toMatch(/cls-a1|coach-a|only-a|cat-only-a/);
  });
});
