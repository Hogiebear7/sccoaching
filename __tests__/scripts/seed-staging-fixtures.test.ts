// scripts/seed-staging-fixtures.mjs: the two-gym fixture generator for isolated staging and test data.
//
// Everything runs in temporary directories with the real script as a child process. The repository's data/ folder is never read or
// written: the only runs that name it are refusals, and those are decided by path alone before any disk access. Fixture passwords
// are random per run and live only in a temporary credentials file the test itself creates. No fixed password appears in this file.
import { spawnSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { pathToFileURL } from "url";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { validatePasswordStrength, verifyPassword } from "@/lib/password";
import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const REPO = process.cwd();
const SCRIPT = path.join(REPO, "scripts", "seed-staging-fixtures.mjs");

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "fixtures-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

type Out = { code: number | null; out: string; err: string };
function run(env: Record<string, string>, args: string[]): Out {
  const base: Record<string, string | undefined> = { ...process.env };
  for (const k of ["GYM_DB_PATH", "DATA_DIR", "SANDC_APP_CONFIG"]) delete base[k];
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, env: { ...base, ...env } as NodeJS.ProcessEnv, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const dbFile = () => path.join(root, "staging", "db.json");
const credsFile = () => path.join(root, "creds.json");
type Account = { email: string; role: string; gym: string; password: string };
const readCreds = (file = credsFile()) => JSON.parse(readFileSync(file, "utf8")) as { accounts: Account[] };
const readDbJson = (file = dbFile()) => JSON.parse(readFileSync(file, "utf8"));
const generate = (extra: string[] = []) => run({ GYM_DB_PATH: dbFile() }, ["--credentials-out", credsFile(), ...extra]);

describe("refusals (nothing is written)", () => {
  it("requires GYM_DB_PATH explicitly, even when DATA_DIR is set: there is no fallback", () => {
    const r = run({ DATA_DIR: path.join(root, "some-data-dir") }, ["--credentials-out", credsFile()]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/GYM_DB_PATH is required/);
    expect(readdirSync(root)).toEqual([]);
  });

  it("treats a blank GYM_DB_PATH as missing", () => {
    expect(run({ GYM_DB_PATH: "   " }, ["--dry-run"]).code).toBe(2);
  });

  it.each([["data/db.json"], [path.join("data", "nested", "x.json")], [path.join(REPO, "data", "db.json")], [path.join(REPO, "data", "other.json")]])(
    "refuses the repository data folder (%s), by path alone",
    (target) => {
      const r = run({ GYM_DB_PATH: path.isAbsolute(target) ? target : path.join(REPO, target) }, ["--dry-run"]);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/inside the repository data folder/);
    }
  );

  it("refuses a relative path that resolves into the repository data folder", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--dry-run"], { cwd: REPO, env: { ...process.env, GYM_DB_PATH: path.join("data", "db.json") } as NodeJS.ProcessEnv, encoding: "utf8" });
    expect(r.status).toBe(2);
  });

  it.each(["db.txt", "db", "script.js"])("refuses a non-.json target (%s)", (name) => {
    const r = run({ GYM_DB_PATH: path.join(root, name) }, ["--dry-run"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/must be a \.json file/);
    expect(existsSync(path.join(root, name))).toBe(false);
  });

  it("refuses a directory", () => {
    const dir = path.join(root, "a-dir.json");
    mkdirSync(dir);
    const r = run({ GYM_DB_PATH: dir }, ["--dry-run"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/is a directory/);
  });

  it("requires --credentials-out for a real run", () => {
    const r = run({ GYM_DB_PATH: dbFile() }, []);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--credentials-out/);
    expect(existsSync(dbFile())).toBe(false);
  });

  it("refuses a credentials file inside the repository", () => {
    const inRepo = path.join(REPO, "scratch-fixture-creds.json");
    const r = run({ GYM_DB_PATH: dbFile() }, ["--credentials-out", inRepo]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/inside the repository/);
    expect(existsSync(inRepo)).toBe(false);
    expect(existsSync(dbFile())).toBe(false);
  });

  it("refuses a credentials file that is the datastore, one that exists, or one whose folder is missing", () => {
    expect(run({ GYM_DB_PATH: dbFile() }, ["--credentials-out", dbFile()]).code).toBe(2);
    writeFileSync(credsFile(), "keep me");
    const exists = generate();
    expect(exists.code).toBe(2);
    expect(exists.err).toMatch(/already exists/);
    expect(readFileSync(credsFile(), "utf8")).toBe("keep me");
    expect(run({ GYM_DB_PATH: dbFile() }, ["--credentials-out", path.join(root, "no-such-folder", "c.json")]).code).toBe(2);
    expect(existsSync(dbFile())).toBe(false);
  });

  it("rejects an unknown argument", () => {
    expect(run({ GYM_DB_PATH: dbFile() }, ["--credentials-out", credsFile(), "--wipe-everything"]).code).toBe(2);
  });
});

describe("dry run", () => {
  it("reports the target and accounts and writes neither a datastore nor a credentials file", () => {
    const r = generate(["--dry-run"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Fixture target: ${dbFile()} (from GYM_DB_PATH)`);
    expect(r.out).toContain("Mode: dry run");
    expect(r.out).toContain("fixture-admin@example.test");
    expect(r.out).toContain("Dry run: nothing was written");
    expect(readdirSync(root)).toEqual([]);
  });

  it("does not need --credentials-out", () => {
    expect(run({ GYM_DB_PATH: dbFile() }, ["--dry-run"]).code).toBe(0);
  });
});

describe("a real run", () => {
  it("creates the datastore and the credentials file, and prints no password", () => {
    const r = generate();
    expect(r.code).toBe(0);
    const creds = readCreds();
    expect(creds.accounts).toHaveLength(6);
    const everything = r.out + r.err + readFileSync(dbFile(), "utf8");
    for (const a of creds.accounts) {
      expect(everything).not.toContain(a.password);
      expect(r.out).toContain(a.email);
    }
    expect(r.out).toContain(`Passwords were written to ${credsFile()}`);
  });

  it.skipIf(process.platform === "win32")("makes the credentials file and the datastore owner-only", () => {
    generate();
    expect(statSync(credsFile()).mode & 0o777).toBe(0o600);
    expect(statSync(dbFile()).mode & 0o777).toBe(0o600);
  });

  it("generates strong, unique, per-account passwords that match the stored hashes, and different ones on every run", () => {
    generate();
    const first = readCreds().accounts;
    const db = readDbJson();
    expect(new Set(first.map((a) => a.password)).size).toBe(first.length);
    for (const a of first) {
      expect(validatePasswordStrength(a.password)).toBeNull();
      const user = db.users.find((u: { email: string }) => u.email === a.email);
      expect(user.passwordHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
      expect(verifyPassword(a.password, user.passwordHash)).toBe(true);
    }
    const second = path.join(root, "second-db.json");
    const secondCreds = path.join(root, "second-creds.json");
    expect(run({ GYM_DB_PATH: second }, ["--credentials-out", secondCreds]).code).toBe(0);
    const again = readCreds(secondCreds).accounts;
    for (const a of first) expect(again.map((x) => x.password)).not.toContain(a.password);
  });

  it("contains no fixed or publicly documented password anywhere: source, output, datastore or credentials", () => {
    const banned = ["Demo", "1234", "!"].join("");
    const r = generate();
    const source = readFileSync(SCRIPT, "utf8");
    for (const text of [source, r.out, r.err, readFileSync(dbFile(), "utf8"), readFileSync(credsFile(), "utf8")]) expect(text).not.toContain(banned);
    for (const a of readCreds().accounts) expect(a.password).not.toBe(banned);
  });

  it("uses only @example.test addresses, with clearly fake names and no provider, payment or IAP records", () => {
    generate();
    const db = readDbJson();
    for (const u of db.users) expect(u.email).toMatch(/^fixture-[a-z0-9-]+@example\.test$/);
    for (const g of db.gyms) {
      expect(g.contactEmail).toMatch(/@example\.test$/);
      expect(g.name).toMatch(/^Fixture /);
      expect(g.description).toMatch(/safe to delete/i);
    }
    for (const p of db.profiles) {
      expect(p.email).toMatch(/@example\.test$/);
      expect(p.fullName).toMatch(/^Fixture /);
    }
    const forbidden = ["purchases", "revenueEvents", "paymentEvents", "googlePlayPurchases", "iapEvents", "iapNotifications", "financeLedgerEntries", "pushSubscriptions", "expoPushTokens"];
    for (const key of forbidden) expect(Object.keys(db)).not.toContain(key);
    for (const s of db.subscriptions) {
      expect(s.provider).toBe("none");
      expect(s.providerSubscriptionId).toBeNull();
      expect(s.providerCustomerId).toBeNull();
    }
    for (const o of db.membershipBillingOptions) {
      expect(o.amountCents).toBe(0);
      expect(o.stripePriceId).toBeNull();
    }
    for (const p of db.membershipPackages) expect(p.stripeProductId).toBeNull();
  });
});

describe("fixture data model", () => {
  it("has the primary gym and a second gym, with every record stamped to the right gym", () => {
    generate();
    const db = readDbJson();
    const [primary, second] = db.gyms;
    expect(primary.slug).toBe("sc-performance-coaching");
    expect(second.slug).toBe("fixture-second-gym");

    const byEmail = (e: string) => db.users.find((u: { email: string }) => u.email === e);
    // Primary-gym users carry no gymId (the established convention); second-gym users carry its id.
    for (const e of ["admin", "coach", "member-a1", "member-a2"]) expect(byEmail(`fixture-${e}@example.test`).gymId ?? null).toBeNull();
    for (const e of ["gymb-admin", "gymb-member"]) expect(byEmail(`fixture-${e}@example.test`).gymId).toBe(second.id);
    expect(byEmail("fixture-admin@example.test").role).toBe("admin_manager");
    expect(byEmail("fixture-coach@example.test").role).toBe("coach");
    expect(primary.ownerUserId).toBe(byEmail("fixture-admin@example.test").id);
    expect(second.ownerUserId).toBe(byEmail("fixture-gymb-admin@example.test").id);

    const classOf = (title: string) => db.classes.find((c: { title: string }) => c.title === title);
    expect(classOf("Fixture Strength").gymId).toBeNull();
    expect(classOf("Fixture Second Gym Class").gymId).toBe(second.id);
    const coachGym = (c: { coachUserId: string }) => db.users.find((u: { id: string }) => u.id === c.coachUserId).gymId ?? null;
    for (const c of db.classes) expect(coachGym(c)).toBe(c.gymId ?? null);

    const categoryGyms = db.membershipCategories.map((c: { gymId: string | null }) => c.gymId);
    expect(categoryGyms).toEqual([null, second.id]);
    for (const s of db.subscriptions) {
      const owner = db.users.find((u: { id: string }) => u.id === s.userId);
      expect(s.ownerGym).toEqual({ scope: "gym", gymId: owner.gymId ?? null });
      expect(s.status).toBe("active");
    }
  });

  it("gives one primary member a programme, recovery check-ins, bookings, and a coach conversation for device checks", () => {
    generate();
    const db = readDbJson();
    const a1 = db.users.find((u: { email: string }) => u.email === "fixture-member-a1@example.test");
    expect(db.programmes.filter((p: { userId: string }) => p.userId === a1.id)).toHaveLength(1);
    expect(db.recoveryLogs.filter((r: { userId: string }) => r.userId === a1.id).length).toBeGreaterThanOrEqual(3);
    expect(db.bookings.some((b: { userId: string }) => b.userId === a1.id)).toBe(true);
    expect(db.messages.filter((m: { memberId: string }) => m.memberId === a1.id)).toHaveLength(2);
    expect(db.profiles.find((p: { userId: string }) => p.userId === a1.id).programmeEnabled).toBe(true);
  });
});

describe("re-runs", () => {
  it("refuse an existing datastore without --reset and leave it byte-for-byte unchanged", () => {
    generate();
    const before = readFileSync(dbFile(), "utf8");
    const r = run({ GYM_DB_PATH: dbFile() }, ["--credentials-out", path.join(root, "again.json")]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/already exists.*--reset/);
    expect(readFileSync(dbFile(), "utf8")).toBe(before);
    expect(existsSync(path.join(root, "again.json"))).toBe(false);
  });

  it("--reset replaces a fixture datastore with fresh passwords and keeps a backup", () => {
    generate();
    const old = readCreds().accounts;
    const again = path.join(root, "again.json");
    const r = run({ GYM_DB_PATH: dbFile() }, ["--credentials-out", again, "--reset"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Mode: reset");
    const fresh = readCreds(again).accounts;
    for (const a of old) expect(fresh.map((x) => x.password)).not.toContain(a.password);
    expect(readdirSync(path.dirname(dbFile())).some((f) => f.startsWith("db.json.bak-"))).toBe(true);
    for (const a of fresh) {
      const user = readDbJson().users.find((u: { email: string }) => u.email === a.email);
      expect(verifyPassword(a.password, user.passwordHash)).toBe(true);
    }
  });

  it("--reset refuses a datastore that is not made entirely of @example.test users, and changes nothing", () => {
    mkdirSync(path.dirname(dbFile()), { recursive: true });
    const real = JSON.stringify({ users: [{ email: "someone@example.test" }, { email: "owner@real-domain.org" }] });
    writeFileSync(dbFile(), real);
    const r = run({ GYM_DB_PATH: dbFile() }, ["--credentials-out", credsFile(), "--reset"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/not a fixture datastore/);
    expect(readFileSync(dbFile(), "utf8")).toBe(real);
    expect(existsSync(credsFile())).toBe(false);
  });

  it("--reset refuses an unreadable or empty datastore", () => {
    mkdirSync(path.dirname(dbFile()), { recursive: true });
    writeFileSync(dbFile(), "not json");
    expect(run({ GYM_DB_PATH: dbFile() }, ["--credentials-out", credsFile(), "--reset"]).code).toBe(2);
    writeFileSync(dbFile(), JSON.stringify({ users: [] }));
    expect(run({ GYM_DB_PATH: dbFile() }, ["--credentials-out", credsFile(), "--reset"]).code).toBe(2);
  });
});

describe("the generated datastore works in the real app", () => {
  const savedDataDir = process.env.DATA_DIR;
  afterEach(() => {
    if (savedDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = savedDataDir;
  });

  async function loadApp() {
    expect(generate().code).toBe(0);
    const appData = path.join(root, "app-data");
    mkdirSync(appData);
    copyFileSync(dbFile(), path.join(appData, "db.json"));
    process.env.DATA_DIR = appData;
    vi.resetModules();
    const db = await import("@/lib/db");
    return db;
  }

  const post = async (route: string, body: unknown, cookie?: string, params?: Record<string, string>) => {
    const mod = await import(`@/app/api/${route}/route`);
    const url = `http://localhost/api/${route}`;
    return mod.POST(
      new NextRequest(url, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) }),
      params ? { params: Promise.resolve(params) } : undefined
    );
  };
  const cookieFor = (userId: string) => `session=${signSession({ userId }, MEMBER_SESSION_LIFETIME_MS)}`;

  it("lets every generated account log in with its own generated password (the hashes are compatible)", async () => {
    await loadApp();
    for (const a of readCreds().accounts) {
      const res = await post("auth/login", { email: a.email, password: a.password });
      expect(res.status, a.email).toBe(200);
    }
  });

  it("starts a fresh member on the first-run walkthrough", async () => {
    const db = await loadApp();
    const a1 = db.findUserByEmail("fixture-member-a1@example.test")!;
    expect(db.findProfileByUserId(a1.id)?.dashboardTourCompleted).toBe(false);
  });

  it("applies the existing tenant checks: staff reach their own gym's members and never the other gym's", async () => {
    const db = await loadApp();
    const id = (e: string) => db.findUserByEmail(`fixture-${e}@example.test`)!.id;
    const pause = (staff: string, member: string) =>
      post("staff/members/[userId]/pause", { action: "pause", duration: "2w" }, cookieFor(id(staff)), { userId: id(member) });

    const cross1 = await pause("admin", "gymb-member");
    expect(cross1.status).toBe(404);
    expect((await cross1.json()).message).toBe("Member not found.");
    expect((await pause("gymb-admin", "member-a1")).status).toBe(404);
    expect(db.findSubscriptionByUserId(id("gymb-member"))?.status).toBe("active");
    expect(db.findSubscriptionByUserId(id("member-a1"))?.status).toBe("active");

    expect((await pause("admin", "member-a1")).status).toBe(200);
    expect(db.findSubscriptionByUserId(id("member-a1"))?.status).toBe("paused");
    expect((await pause("gymb-admin", "gymb-member")).status).toBe(200);
  });
});

describe("symlinked repository paths", () => {
  // Uses the script's own resolveTargets with a FAKE repository root inside the temp folder, so the real repository, and its data/
  // folder, are never involved. A directory link (a junction on Windows, which needs no special privilege) stands in for the symlink.
  async function setup() {
    const fakeRepo = path.join(root, "fake-repo");
    const outside = path.join(root, "outside");
    mkdirSync(path.join(fakeRepo, "data"), { recursive: true });
    mkdirSync(outside);
    symlinkSync(path.join(fakeRepo, "data"), path.join(outside, "link-to-data"), "junction");
    symlinkSync(fakeRepo, path.join(outside, "link-to-repo"), "junction");
    const mod = (await import(pathToFileURL(SCRIPT).href)) as {
      resolveTargets: (env: Record<string, string>, args: { dryRun: boolean; credentialsOut: string | null }, repoRoot: string) => { dbPath: string; credentialsPath: string | null };
    };
    return { fakeRepo, outside, resolve: mod.resolveTargets };
  }

  it("refuses a datastore reached through a link to the repository data folder, existing or new", async () => {
    const { fakeRepo, outside, resolve } = await setup();
    const args = { dryRun: true, credentialsOut: null };
    expect(() => resolve({ GYM_DB_PATH: path.join(fakeRepo, "data", "db.json") }, args, fakeRepo)).toThrow(/inside the repository data folder/);
    expect(() => resolve({ GYM_DB_PATH: path.join(outside, "link-to-data", "db.json") }, args, fakeRepo)).toThrow(/inside the repository data folder/);
    expect(() => resolve({ GYM_DB_PATH: path.join(outside, "link-to-data", "sub", "new.json") }, args, fakeRepo)).toThrow(/inside the repository data folder/);
    expect(() => resolve({ GYM_DB_PATH: path.join(outside, "link-to-repo", "data", "db.json") }, args, fakeRepo)).toThrow(/inside the repository data folder/);
  });

  it("refuses a credentials file reached through a link into the repository", async () => {
    const { fakeRepo, outside, resolve } = await setup();
    const db = path.join(outside, "staging.json");
    expect(() => resolve({ GYM_DB_PATH: db }, { dryRun: false, credentialsOut: path.join(outside, "link-to-repo", "creds.json") }, fakeRepo)).toThrow(/inside the repository/);
  });

  it("still allows an ordinary path outside the repository (control)", async () => {
    const { fakeRepo, outside, resolve } = await setup();
    const t = resolve({ GYM_DB_PATH: path.join(outside, "staging.json") }, { dryRun: true, credentialsOut: null }, fakeRepo);
    expect(t.dbPath).toBe(path.join(outside, "staging.json"));
  });

  it("writes nothing while refusing", async () => {
    const { fakeRepo, outside, resolve } = await setup();
    expect(() => resolve({ GYM_DB_PATH: path.join(outside, "link-to-data", "db.json") }, { dryRun: true, credentialsOut: null }, fakeRepo)).toThrow();
    expect(readdirSync(path.join(fakeRepo, "data"))).toEqual([]);
  });
});
