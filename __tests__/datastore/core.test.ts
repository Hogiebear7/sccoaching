// Datastore core: transactions, stale snapshots, fencing, atomic replacement, missing and malformed files, lock recovery, and the script protocol.
// REAL files in a temporary directory; real child processes where liveness matters. Nothing here touches a real datastore.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as core from "@/lib/datastore/core";

let dir: string;
let db: string;
const children: ChildProcess[] = [];
const endTurn = () => new Promise<void>((r) => setImmediate(r));
const lockPath = () => `${db}.lock`;
const files = () => fs.readdirSync(dir).sort();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "datastore-core-"));
  db = path.join(dir, "db.json");
});
afterEach(async () => {
  await endTurn();
  for (const c of children.splice(0)) c.kill("SIGKILL");
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function commit(items: string[]) {
  const { text, epoch } = core.readInTurn(db, { allowNew: true });
  const doc = text === null ? { items: [] as string[] } : (JSON.parse(text) as { items: string[] });
  doc.items.push(...items);
  core.writeInTurn(db, JSON.stringify(doc), epoch);
  await endTurn();
}
const content = () => JSON.parse(fs.readFileSync(db, "utf8")) as { items: string[] };

/** A fresh copy of the module with a short lock wait, so BUSY outcomes are quick. */
async function coreWithWait(ms: number): Promise<typeof core> {
  vi.resetModules();
  vi.stubEnv("SANDC_DATASTORE_LOCK_WAIT_MS", String(ms));
  return (await import("@/lib/datastore/core")) as typeof core;
}
function writeLock(owner: Record<string, unknown>) {
  fs.writeFileSync(lockPath(), JSON.stringify({ ownerId: "x".repeat(16), pid: 1, host: "h", procStart: null, takenAt: Date.now(), ...owner }));
}
function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", ""]);
  return r.pid!;
}
function livePid(): number {
  const c = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  children.push(c);
  return c.pid!;
}
const sameHost = () => os.hostname();

describe("a normal transaction", () => {
  it("creates the file atomically, marks the directory as holding a datastore, keeps owner-only permissions and leaves nothing behind", async () => {
    await commit(["a"]);
    expect(content().items).toEqual(["a"]);
    expect(fs.existsSync(path.join(dir, core.MARKER_NAME))).toBe(true);
    expect(files()).toEqual([core.MARKER_NAME, "db.json"]); // no lock, no temp file
    if (process.platform !== "win32") expect(fs.statSync(db).mode & 0o777).toBe(0o600);
  });

  it("preserves the permissions of an existing datastore file", async () => {
    fs.writeFileSync(db, JSON.stringify({ items: [] }), { mode: 0o640 });
    await commit(["a"]);
    if (process.platform !== "win32") expect(fs.statSync(db).mode & 0o777).toBe(0o640);
  });

  it("holds the lock for the whole synchronous turn and releases it when the turn ends", async () => {
    const first = core.readInTurn(db, { allowNew: true });
    expect(fs.existsSync(lockPath())).toBe(true);
    const second = core.readInTurn(db, { allowNew: true }); // later db call in the same turn: same lock, same transaction
    expect(second.epoch).toBe(first.epoch);
    await endTurn();
    expect(fs.existsSync(lockPath())).toBe(false);
    expect(core.readInTurn(db, { allowNew: true }).epoch).toBeGreaterThan(first.epoch);
    await endTurn();
  });

  it("several reads and writes in one turn all see the latest file (read-latest, modify, write as one unit)", async () => {
    const a = core.readInTurn(db, { allowNew: true });
    core.writeInTurn(db, JSON.stringify({ items: ["one"] }), a.epoch);
    const b = core.readInTurn(db, { allowNew: true });
    expect(JSON.parse(b.text!).items).toEqual(["one"]);
    core.writeInTurn(db, JSON.stringify({ items: ["one", "two"] }), b.epoch);
    await endTurn();
    expect(content().items).toEqual(["one", "two"]);
  });
});

describe("no stale snapshot can overwrite newer data", () => {
  it("refuses to write a snapshot read in an earlier turn, and leaves the file as it was", async () => {
    await commit(["base"]);
    const old = core.readInTurn(db, { allowNew: true });
    await endTurn(); // the turn ends: the snapshot is now stale by definition
    await commit(["newer"]); // somebody (maybe another process) changes the file
    expect(() => core.writeInTurn(db, JSON.stringify({ items: ["from-stale-snapshot"] }), old.epoch)).toThrowError(expect.objectContaining({ code: "STALE_SNAPSHOT" }));
    expect(content().items).toEqual(["base", "newer"]);
  });

  it("refuses a stale snapshot even in a LATER turn that does hold the lock and sees an unchanged file (the case a plain lock cannot catch)", async () => {
    await commit(["base"]);
    const old = core.readInTurn(db, { allowNew: true }); // snapshot from turn 1: items = [base]
    await endTurn();
    await commit(["newer"]); // turn 2 changes the file
    core.readInTurn(db, { allowNew: true }); // turn 3 holds the lock and has read the CURRENT file, so the fence would pass
    expect(() => core.writeInTurn(db, JSON.stringify({ items: JSON.parse(old.text!).items.concat("from-stale-snapshot") }), old.epoch)).toThrowError(
      expect.objectContaining({ code: "STALE_SNAPSHOT" })
    );
    expect(content().items).toEqual(["base", "newer"]);
    await endTurn();
  });

  it("fences the commit: if the file changed underneath the snapshot, nothing is written", async () => {
    await commit(["base"]);
    const { epoch } = core.readInTurn(db, { allowNew: true });
    fs.writeFileSync(db, JSON.stringify({ items: ["base", "written-by-someone-else-despite-the-lock"] })); // simulates a failed lock
    expect(() => core.writeInTurn(db, JSON.stringify({ items: ["mine"] }), epoch)).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
    expect(content().items).toEqual(["base", "written-by-someone-else-despite-the-lock"]);
    await endTurn();
  });

  it("refuses to commit if the lock was taken away from this process", async () => {
    const { epoch } = core.readInTurn(db, { allowNew: true });
    fs.unlinkSync(lockPath());
    expect(() => core.writeInTurn(db, JSON.stringify({ items: ["x"] }), epoch)).toThrowError(expect.objectContaining({ code: "LOCK_LOST" }));
    expect(fs.existsSync(db)).toBe(false);
    await endTurn();
  });
});

describe("atomic replacement", () => {
  it("writes a temporary file in the SAME directory and renames it over the datastore", async () => {
    await commit(["a"]);
    const rename = vi.spyOn(fs, "renameSync");
    await commit(["b"]);
    const [from, to] = rename.mock.calls.at(-1)!.map(String);
    expect(path.dirname(from)).toBe(path.dirname(to));
    expect(path.basename(from)).toMatch(/^\.db\.json\.tmp-\d+-[0-9a-f]+$/);
    expect(to).toBe(db);
  });

  it("a failure while writing the temporary file leaves the old file intact and removes the temporary file", async () => {
    await commit(["a"]);
    const before = fs.readFileSync(db, "utf8");
    vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    });
    await expect(commit(["b"])).rejects.toThrow(/disk full/);
    expect(fs.readFileSync(db, "utf8")).toBe(before);
    expect(files().filter((f) => f.includes(".tmp-"))).toEqual([]);
  });

  it("a failure at the rename leaves the old file intact and removes the temporary file", async () => {
    await commit(["a"]);
    const before = fs.readFileSync(db, "utf8");
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
    });
    await expect(commit(["b"])).rejects.toThrow(/cross-device/);
    expect(fs.readFileSync(db, "utf8")).toBe(before);
    expect(files().filter((f) => f.includes(".tmp-"))).toEqual([]);
  });

  it("removes a temporary file left by a process that died mid-write, and never one owned by a live process", async () => {
    const dead = path.join(dir, `.db.json.tmp-${deadPid()}-aaaa`);
    const live = path.join(dir, `.db.json.tmp-${livePid()}-bbbb`);
    fs.writeFileSync(dead, "{");
    fs.writeFileSync(live, "{");
    await commit(["a"]);
    expect(fs.existsSync(dead)).toBe(false);
    expect(fs.existsSync(live)).toBe(true);
  });
});

describe("a missing or malformed datastore never becomes a new empty one by accident", () => {
  it("in a place that has never held a datastore, creating one needs explicit permission", () => {
    expect(() => core.readInTurn(db, { allowNew: false })).toThrowError(expect.objectContaining({ code: "DATASTORE_NOT_INITIALISED" }));
  });

  it("once a datastore has existed here, a missing file is an error even when new datastores are allowed", async () => {
    await commit(["a"]);
    fs.unlinkSync(db); // lost, or the deploy pointed at a different folder state
    expect(() => core.readInTurn(db, { allowNew: true })).toThrowError(expect.objectContaining({ code: "DATASTORE_MISSING" }));
    expect(fs.existsSync(db)).toBe(false); // and nothing was created
    await endTurn();
  });

  it.each([
    ["not JSON", "{not json"],
    ["a torn write", '{"items":["a","b'],
    ["empty", ""],
    ["a JSON array", "[1,2]"],
    ["JSON null", "null"],
  ])("a malformed file (%s) is reported and never overwritten", async (_label, bad) => {
    fs.writeFileSync(db, bad);
    const { text } = core.readInTurn(db, { allowNew: true });
    expect(() => core.parseDatastoreText(text!, db)).toThrowError(expect.objectContaining({ code: "DATASTORE_CORRUPT" }));
    await endTurn();
    expect(fs.readFileSync(db, "utf8")).toBe(bad);
    expect(files().filter((f) => f.includes(".tmp-"))).toEqual([]);
  });
});

describe("lock recovery cannot create two live writers", () => {
  it("takes over a lock whose owner process is dead", async () => {
    writeLock({ pid: deadPid(), host: sameHost() });
    await commit(["after-takeover"]);
    expect(content().items).toEqual(["after-takeover"]);
    expect(files().filter((f) => f.includes(".dead-"))).toEqual([]);
  });

  it("NEVER takes over a lock whose owner is alive: it waits and then reports BUSY, leaving the holder's lock untouched", async () => {
    const c = await coreWithWait(400);
    writeLock({ ownerId: "live-holder-0001", pid: livePid(), host: sameHost() });
    expect(() => c.readInTurn(db, { allowNew: true })).toThrowError(expect.objectContaining({ code: "DATASTORE_BUSY" }));
    expect(JSON.parse(fs.readFileSync(lockPath(), "utf8")).ownerId).toBe("live-holder-0001");
  });

  it("never takes over a lock held on another host, because liveness cannot be judged", async () => {
    const c = await coreWithWait(400);
    writeLock({ ownerId: "other-host-0001", pid: deadPid(), host: "some-other-host" });
    expect(() => c.readInTurn(db, { allowNew: true })).toThrowError(expect.objectContaining({ code: "DATASTORE_BUSY" }));
    expect(fs.existsSync(lockPath())).toBe(true);
  });

  it.runIf(process.platform === "linux")("recognises a reused pid: a live pid with a different start time is not the original owner", async () => {
    writeLock({ pid: livePid(), host: sameHost(), procStart: "1" });
    await commit(["after-pid-reuse"]);
    expect(content().items).toEqual(["after-pid-reuse"]);
  });

  it("waits for a lock file that is still being written, but removes an unreadable one once it is clearly abandoned", async () => {
    const c = await coreWithWait(300);
    fs.writeFileSync(lockPath(), ""); // created, owner not written yet
    expect(() => c.readInTurn(db, { allowNew: true })).toThrowError(expect.objectContaining({ code: "DATASTORE_BUSY" }));
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath(), old, old);
    await commit(["after-garbage-lock"]);
    expect(content().items).toEqual(["after-garbage-lock"]);
  });

  it("treats a leftover lock that names THIS process but is not currently held as abandoned", async () => {
    writeLock({ ownerId: "leftover-of-mine", pid: process.pid, host: sameHost() });
    await commit(["a"]);
    expect(content().items).toEqual(["a"]);
  });

  it("only removes its own lock on release", async () => {
    const owner = core._acquireLock(db);
    fs.writeFileSync(lockPath(), JSON.stringify({ ownerId: "someone-else-1", pid: 1, host: "h", procStart: null, takenAt: Date.now() }));
    core._releaseLock(db, owner);
    expect(JSON.parse(fs.readFileSync(lockPath(), "utf8")).ownerId).toBe("someone-else-1");
  });
});

describe("operator scripts use the same protocol", () => {
  it("refuse a missing or malformed datastore instead of defaulting", () => {
    expect(() => core.readForScript(db)).toThrowError(expect.objectContaining({ code: "DATASTORE_MISSING" }));
    fs.writeFileSync(db, "{oops");
    expect(() => core.readForScript(db)).toThrowError(expect.objectContaining({ code: "DATASTORE_CORRUPT" }));
    expect(fs.readFileSync(db, "utf8")).toBe("{oops");
  });

  it("write only if the file is still the version they read (compare and swap), atomically, under the lock", async () => {
    fs.writeFileSync(db, JSON.stringify({ items: ["a"] }));
    const { db: doc, token } = core.readForScript(db);
    (doc as { items: string[] }).items.push("from-script");
    core.writeForScript(db, doc, token);
    expect(content().items).toEqual(["a", "from-script"]);
    expect(fs.existsSync(lockPath())).toBe(false);

    const second = core.readForScript(db);
    await commit(["written-by-the-app-meanwhile"]);
    (second.db as { items: string[] }).items.push("stale-script-result");
    expect(() => core.writeForScript(db, second.db, second.token)).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
    expect(content().items).toEqual(["a", "from-script", "written-by-the-app-meanwhile"]);
  });

  it("wait for an app transaction that holds the lock instead of overwriting it", async () => {
    const c = await coreWithWait(300);
    fs.writeFileSync(db, JSON.stringify({ items: [] }));
    writeLock({ ownerId: "app-turn-0001", pid: livePid(), host: sameHost() });
    expect(() => c.writeForScript(db, { items: ["x"] }, undefined)).toThrowError(expect.objectContaining({ code: "DATASTORE_BUSY" }));
    expect(content().items).toEqual([]);
  });

  it("every operator script that writes the datastore goes through the protocol (no direct write remains)", () => {
    const scriptsDir = path.join(process.cwd(), "scripts");
    const offenders: string[] = [];
    for (const f of fs.readdirSync(scriptsDir).filter((n) => /\.(mjs|js|cjs)$/.test(n) && n !== "tmp-inspect.mjs")) {
      const src = fs.readFileSync(path.join(scriptsDir, f), "utf8");
      if (/writeFileSync\(\s*(DB_PATH|dbPath)\b/.test(src) || /const writeDb = \(db\) => writeFileSync/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});

describe("filesystem preflight script", () => {
  it("passes on a normal local filesystem, works only inside its own scratch folder, and leaves nothing behind", () => {
    const before = fs.readdirSync(dir);
    const r = spawnSync(process.execPath, [path.join(process.cwd(), "scripts", "check-datastore-filesystem.mjs"), "--dir", dir], { encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("All 6 checks passed");
    expect(fs.readdirSync(dir)).toEqual(before);
  });

  it("refuses to run without a folder", () => {
    const r = spawnSync(process.execPath, [path.join(process.cwd(), "scripts", "check-datastore-filesystem.mjs")], { encoding: "utf8" });
    expect(r.status).toBe(2);
  });
});

describe("a writer that does not take the lock is DETECTED (an old build run again against this folder)", () => {
  it("an in-place rewrite of the file this process committed is reported as a possible foreign write; a hardened process's replacement is not", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const before = core._foreignWriteCount();
    await commit(["a"]);
    await commit(["b"]); // our own commits: nothing to report
    expect(core._foreignWriteCount()).toBe(before);

    // another hardened process replaces the file (atomic rename = a new inode): normal, not reported
    core._atomicReplace(db, JSON.stringify({ items: ["a", "b", "from-other-hardened-process"] }));
    await commit(["c"]);
    expect(core._foreignWriteCount()).toBe(before);

    // the OLD build: truncate and rewrite the same inode in place
    const doc = JSON.parse(fs.readFileSync(db, "utf8")) as { items: string[] };
    doc.items.push("from-old-unlocked-build");
    fs.writeFileSync(db, JSON.stringify(doc), "utf8");
    core.readInTurn(db, { allowNew: false });
    await endTurn();
    expect(core._foreignWriteCount()).toBe(before + 1);
    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toContain("possible foreign write");
  });

  it("a reused inode number (a new file with a new creation time) is not reported; the same file rewritten in place is", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await commit(["a"]);
    const [dev, ino, born, ...rest] = core._identityOf(db).split(":");
    const before = core._foreignWriteCount();

    // another hardened process replaced the file and Linux handed it this process's old inode number: different creation time
    core._noteForeignWrite(db, [dev, ino, String(BigInt(born) + BigInt(1000000)), "999", ...rest.slice(1)].join(":"));
    expect(core._foreignWriteCount()).toBe(before);

    // the same file (same creation time) with new content and timestamps: an in-place rewrite
    core._noteForeignWrite(db, [dev, ino, born, "998", ...rest.slice(1)].join(":"));
    expect(core._foreignWriteCount()).toBe(before + 1);
  });

  it("a change of metadata alone (ctime, as a scanner tagging the file does) is not reported", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await commit(["a"]);
    const parts = core._identityOf(db).split(":");
    const before = core._foreignWriteCount();
    core._noteForeignWrite(db, [...parts.slice(0, 5), String(BigInt(parts[5]) + BigInt(900000000))].join(":"));
    expect(core._foreignWriteCount()).toBe(before);
  });

  it("the identity carries the file's creation time", async () => {
    await commit(["a"]);
    const [, , born] = core._identityOf(db).split(":");
    expect(born).toBe(String(fs.statSync(db, { bigint: true }).birthtimeNs));
  });
});
