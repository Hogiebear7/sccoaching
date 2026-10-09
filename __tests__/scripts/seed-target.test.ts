// scripts/seed.js must only ever replace the datastore it was told to, using the project's one path contract:
//   GYM_DB_PATH  >  DATA_DIR/db.json  >  SANDC_APP_CONFIG dataDir  >  <repo>/data/db.json (found from the script, not the cwd).
//
// Every test runs the real script as a child process with a temporary working directory and temporary target paths. The repository's own
// data/ folder is never read or written: the only run that resolves to the built-in default uses --dry-run, which writes nothing.
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO = process.cwd();
const SEED = path.join(REPO, "scripts", "seed.js");
const requireCjs = createRequire(import.meta.url);
const { resolveSeedTarget } = requireCjs(path.join(REPO, "scripts", "seed-target.cjs")) as {
  resolveSeedTarget: (env: Record<string, string | undefined>, scriptDir: string) => { dbPath: string; source: string };
};

let root: string;
let cwd: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "seed-target-"));
  cwd = path.join(root, "cwd");
  mkdirSync(cwd);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(env: Record<string, string>, args: string[] = []) {
  const base: Record<string, string | undefined> = { ...process.env };
  for (const k of ["GYM_DB_PATH", "DATA_DIR", "SANDC_APP_CONFIG"]) delete base[k];
  const r = spawnSync(process.execPath, [SEED, ...args], { cwd, env: { ...base, ...env } as NodeJS.ProcessEnv, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// Structure of the seeded datastore: collection sizes and the demo accounts. Recorded from the script before this change.
const EXPECTED_COUNTS = {
  bookings: 4, classes: 4, coachNotes: 1, cyclePrivacyPreferences: 2, cycleSettings: 2, jobRuns: 0, membershipBillingOptions: 4,
  membershipCategories: 1, membershipPackages: 3, messages: 2, profiles: 7, programmes: 0, recoveryLogs: 5, resetTokens: 0,
  subscriptions: 5, users: 7, waitlistEntries: 1, workoutSessions: 0,
};
const signature = (file: string) => {
  const db = JSON.parse(readFileSync(file, "utf8"));
  return { counts: Object.fromEntries(Object.keys(db).sort().map((k) => [k, Array.isArray(db[k]) ? db[k].length : -1])), emails: db.users.map((u: { email: string }) => u.email).sort() };
};
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)).map((f) => path.join(e.name, f)) : [e.name]));

describe("explicit GYM_DB_PATH", () => {
  it("writes only that named file, even when DATA_DIR is also set, and creates nothing else", () => {
    const target = path.join(root, "named", "staging.json");
    const otherDataDir = path.join(root, "other-data");
    const r = run({ GYM_DB_PATH: target, DATA_DIR: otherDataDir });
    expect(r.code).toBe(0);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(otherDataDir)).toBe(false);
    expect(files(root).sort()).toEqual([path.join("named", "staging.json")]);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("resolves a relative path against the working directory, like the shell", () => {
    const r = run({ GYM_DB_PATH: path.join("sub", "relative.json") });
    expect(r.code).toBe(0);
    expect(existsSync(path.join(cwd, "sub", "relative.json"))).toBe(true);
  });
});

describe("DATA_DIR", () => {
  it("writes DATA_DIR/db.json, creating only that folder, and nothing in the working directory", () => {
    const dataDir = path.join(root, "staging", "data");
    const r = run({ DATA_DIR: dataDir });
    expect(r.code).toBe(0);
    expect(files(dataDir)).toEqual(["db.json"]);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("wins over SANDC_APP_CONFIG's dataDir", () => {
    const a = path.join(root, "a");
    const b = path.join(root, "b");
    expect(run({ DATA_DIR: a, SANDC_APP_CONFIG: `dataDir=${b}` }).code).toBe(0);
    expect(existsSync(path.join(a, "db.json"))).toBe(true);
    expect(existsSync(b)).toBe(false);
  });
});

describe("SANDC_APP_CONFIG", () => {
  it("uses only its dataDir entry and ignores every other key", () => {
    const dir = path.join(root, "hosted");
    const cfg = `sessionSecret=not-a-real-secret|appUrl=https://x.example|dataDir=${dir}|resendApiKey=nope`;
    const r = run({ SANDC_APP_CONFIG: cfg });
    expect(r.code).toBe(0);
    expect(files(dir)).toEqual(["db.json"]);
    expect(r.out + r.err).not.toContain("not-a-real-secret");
    expect(r.out + r.err).not.toContain("nope");
  });
});

describe("built-in default", () => {
  it("is the repository data folder, found from the script and not the working directory (checked with --dry-run, which writes nothing)", () => {
    const r = run({}, ["--dry-run"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Seed target: ${path.join(REPO, "data", "db.json")} (from default (repository data/ folder))`);
    expect(r.out).toContain("Dry run: nothing was written.");
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("resolves identically from any working directory", () => {
    const a = resolveSeedTarget({}, path.join(REPO, "scripts"));
    const prev = process.cwd();
    process.chdir(cwd);
    try {
      expect(resolveSeedTarget({}, path.join(REPO, "scripts"))).toEqual(a);
    } finally {
      process.chdir(prev);
    }
  });
});

describe("dry run", () => {
  it("reports the resolved target and writes nothing for an explicit path", () => {
    const target = path.join(root, "dry.json");
    const r = run({ GYM_DB_PATH: target }, ["--dry-run"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Seed target: ${target} (from GYM_DB_PATH)`);
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(root)).toEqual(["cwd"]);
  });
});

describe("unsafe targets are refused before anything is written", () => {
  it("refuses a directory", () => {
    const dir = path.join(root, "a-dir.json");
    mkdirSync(dir);
    const r = run({ GYM_DB_PATH: dir });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/is a directory/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it.each(["db.txt", "db", "passwd", "script.js"])("refuses a non-.json target (%s)", (name) => {
    const r = run({ GYM_DB_PATH: path.join(root, name) });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/must be a \.json file/);
    expect(existsSync(path.join(root, name))).toBe(false);
  });
});

describe("output and seed content", () => {
  it("prints the target path, never file contents, and keeps the original summary lines", () => {
    const target = path.join(root, "out.json");
    const r = run({ GYM_DB_PATH: target });
    expect(r.out).toContain(`Seed target: ${target} (from GYM_DB_PATH)`);
    expect(r.out).toContain(`Seeded ${target} with demo data.`);
    expect(r.out).toContain("Demo accounts (all use password: Demo1234!):");
    expect(r.out).toContain("Staff:  coach@demo.local");
    expect(r.out).not.toMatch(/passwordHash|"users"/);
  });

  it("seeds exactly the same data whichever rule picked the target, and the same data as before this change", () => {
    const viaPath = path.join(root, "via-path.json");
    const viaDir = path.join(root, "via-dir");
    expect(run({ GYM_DB_PATH: viaPath }).code).toBe(0);
    expect(run({ DATA_DIR: viaDir }).code).toBe(0);
    const a = signature(viaPath);
    const b = signature(path.join(viaDir, "db.json"));
    expect(a).toEqual(b);
    expect(a.counts).toEqual(EXPECTED_COUNTS);
    expect(a.emails).toContain("alex@demo.local");
    expect(a.emails).toContain("coach@demo.local");
  });

  it("starts from a clean slate on a re-run: it replaces the file rather than appending", () => {
    const target = path.join(root, "again.json");
    run({ GYM_DB_PATH: target });
    run({ GYM_DB_PATH: target });
    expect(signature(target).counts).toEqual(EXPECTED_COUNTS);
  });
});

describe("resolveSeedTarget precedence", () => {
  const scripts = path.join(REPO, "scripts");
  it("GYM_DB_PATH, then DATA_DIR, then SANDC_APP_CONFIG, then the default", () => {
    const all = { GYM_DB_PATH: path.join(root, "x.json"), DATA_DIR: path.join(root, "d"), SANDC_APP_CONFIG: `dataDir=${path.join(root, "c")}` };
    expect(resolveSeedTarget(all, scripts)).toEqual({ dbPath: path.join(root, "x.json"), source: "GYM_DB_PATH" });
    expect(resolveSeedTarget({ DATA_DIR: all.DATA_DIR, SANDC_APP_CONFIG: all.SANDC_APP_CONFIG }, scripts).source).toBe("DATA_DIR");
    expect(resolveSeedTarget({ SANDC_APP_CONFIG: all.SANDC_APP_CONFIG }, scripts)).toEqual({ dbPath: path.join(root, "c", "db.json"), source: "SANDC_APP_CONFIG dataDir" });
    expect(resolveSeedTarget({}, scripts).source).toMatch(/^default/);
  });

  it("treats blank values as unset", () => {
    expect(resolveSeedTarget({ GYM_DB_PATH: "  ", DATA_DIR: "", SANDC_APP_CONFIG: "  " }, scripts).source).toMatch(/^default/);
  });
});
