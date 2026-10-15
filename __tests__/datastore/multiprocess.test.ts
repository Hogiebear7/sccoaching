// MULTI-PROCESS datastore tests: real, separate OS processes sharing one datastore directory.
// Every assertion checks EXPECTED CONTENT (each acknowledged update present exactly once, counters exact, no overlapping critical sections),
// not just "the JSON still parses" or "the row count is plausible".
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CHILD = (name: string) => path.join(ROOT, "__tests__", "datastore", "children", name);

let dir: string;
let db: string;
const running: ChildProcess[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "datastore-mp-"));
  db = path.join(dir, "db.json");
});
afterEach(() => {
  for (const c of running.splice(0)) c.kill("SIGKILL");
  fs.rmSync(dir, { recursive: true, force: true });
});

interface Run {
  child: ChildProcess;
  out: () => string;
  done: Promise<number | null>;
}
function start(args: string[], env: Record<string, string> = {}): Run {
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  running.push(child);
  let out = "";
  child.stdout!.on("data", (d) => (out += d));
  child.stderr!.on("data", (d) => (out += d));
  const done = new Promise<number | null>((r) => child.on("close", (code) => r(code)));
  return { child, out: () => out, done };
}
const lines = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean) : []);
const readDoc = () => JSON.parse(fs.readFileSync(db, "utf8")) as { items: string[]; counter?: number };
async function until(cond: () => boolean, ms: number, label: string) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("contention: many processes, every update must land", () => {
  it("8 processes x 60 read-modify-write transactions: exactly 480 distinct updates, an exact counter, and never two processes inside the critical section", async () => {
    const ack = path.join(dir, "ack.txt");
    const bad = path.join(dir, "violations.txt");
    const runs = Array.from({ length: 8 }, (_, i) => start([CHILD("core-txn.cjs"), db, String(i), "60", ack, bad, "2"]));
    const codes = await Promise.all(runs.map((r) => r.done));
    expect(codes).toEqual(Array(8).fill(0));
    expect(lines(bad)).toEqual([]); // no overlap detected, no error from any process
    const doc = readDoc();
    const expected = Array.from({ length: 8 }, (_, w) => Array.from({ length: 60 }, (_, k) => `w${w}-${k}`)).flat();
    expect([...doc.items].sort()).toEqual([...expected].sort()); // every expected update, exactly once
    expect(doc.counter).toBe(480);
    expect(lines(ack).sort()).toEqual([...expected].sort());
    expect(fs.readdirSync(dir).filter((f) => f.includes(".tmp-") || f.endsWith(".lock"))).toEqual([]);
  }, 120_000);
});

describe("representative application operations through the real lib/db.ts", () => {
  it("4 processes x 25 iterations of user, booking, message, food entry and counter writes: every record present once, counter exact", async () => {
    const ack = path.join(dir, "ack.txt");
    const runs = Array.from({ length: 4 }, (_, i) => start(["--import", "tsx", CHILD("db-worker.mts"), String(i), "25", ack], { DATA_DIR: dir, NODE_ENV: "test" }));
    const codes = await Promise.all(runs.map((r) => r.done));
    expect(codes, runs.map((r) => r.out()).join("\n")).toEqual(Array(4).fill(0));

    const data = JSON.parse(fs.readFileSync(db, "utf8"));
    const want = (prefix: string) => Array.from({ length: 4 }, (_, w) => Array.from({ length: 25 }, (_, k) => `${prefix}${w}${prefix === "w" ? `-${k}@example.test` : `-${k}`}`)).flat().sort();
    expect((data.users as { email: string }[]).map((u) => u.email).sort()).toEqual(want("w"));
    expect((data.bookings as { id: string }[]).map((b) => b.id).sort()).toEqual(want("bk-"));
    expect((data.messages as { id: string }[]).map((m) => m.id).sort()).toEqual(want("msg-"));
    expect((data.foodEntries as { id: string }[]).map((f) => f.id).sort()).toEqual(want("fe-"));
    const counter = (data.iapNotifications as { messageId: string; attempts: number }[]).find((n) => n.messageId === "shared-counter");
    expect(counter?.attempts).toBe(4 * 25); // a true read-modify-write counter: any lost update shows here
    expect(lines(ack).filter((l) => l === "counter")).toHaveLength(100);
  }, 180_000);
});

describe("process death", () => {
  it("a process killed while HOLDING the lock does not stall or corrupt the others, and no two processes overlap afterwards", async () => {
    const holder = start([CHILD("lock-holder.cjs"), db]);
    await until(() => holder.out().includes("HELD") && fs.existsSync(`${db}.lock`), 15_000, "the holder to take the lock");
    const holderId = JSON.parse(fs.readFileSync(`${db}.lock`, "utf8")).ownerId;

    const ack = path.join(dir, "ack.txt");
    const bad = path.join(dir, "violations.txt");
    const contenders = Array.from({ length: 4 }, (_, i) => start([CHILD("core-txn.cjs"), db, String(i), "30", ack, bad, "1"]));
    await new Promise((r) => setTimeout(r, 600));
    expect(lines(ack)).toEqual([]); // while the live holder holds the lock, nobody got in
    expect(JSON.parse(fs.readFileSync(`${db}.lock`, "utf8")).ownerId).toBe(holderId); // and nobody displaced it

    holder.child.kill("SIGKILL"); // process death while holding the lock
    const codes = await Promise.all(contenders.map((r) => r.done));
    expect(codes).toEqual(Array(4).fill(0));
    expect(lines(bad).slice(0, 3)).toEqual([]); // the first few lines say what went wrong (an overlap, or which error code)
    const expected = Array.from({ length: 4 }, (_, w) => Array.from({ length: 30 }, (_, k) => `w${w}-${k}`)).flat();
    expect([...readDoc().items].sort()).toEqual([...expected].sort());
    expect(readDoc().counter).toBe(120);
    expect(fs.readdirSync(dir).filter((f) => f.includes(".dead-"))).toEqual([]);
  }, 120_000);

  it("many processes finding the SAME dead lock at once: only one reclaims it, nobody overlaps, nothing is lost (8 rounds)", async () => {
    // Regression for a defect found by a stress run: without a reclaim token, two processes that both saw the dead lock could move aside a LIVE lock the first had
    // just created, and for a moment two processes were inside the critical section (and one failed with LOCK_LOST).
    for (let round = 0; round < 8; round++) {
      const rdir = fs.mkdtempSync(path.join(dir, "dead-"));
      const rdb = path.join(rdir, "db.json");
      fs.writeFileSync(`${rdb}.lock`, JSON.stringify({ ownerId: "deadbeefdeadbeef", pid: 2147483000, host: os.hostname(), procStart: null, takenAt: Date.now() - 60_000 }));
      const ack = path.join(rdir, "ack.txt");
      const bad = path.join(rdir, "violations.txt");
      const runs = Array.from({ length: 8 }, (_, i) => start([CHILD("core-txn.cjs"), rdb, String(i), "15", ack, bad, "1"]));
      expect(await Promise.all(runs.map((r) => r.done))).toEqual(Array(8).fill(0));
      expect(lines(bad).slice(0, 3)).toEqual([]);
      const doc = JSON.parse(fs.readFileSync(rdb, "utf8")) as { items: string[]; counter: number };
      expect(doc.counter).toBe(120);
      expect(new Set(doc.items).size).toBe(120);
      expect(fs.readdirSync(rdir).filter((x) => x.includes(".dead-") || x.endsWith(".reclaim"))).toEqual([]);
    }
  }, 180_000);

  it("a reclaim token left by a process that died mid-reclaim does not block the lock for ever", async () => {
    fs.writeFileSync(`${db}.lock`, JSON.stringify({ ownerId: "deadbeefdeadbeef", pid: 2147483000, host: os.hostname(), procStart: null, takenAt: Date.now() - 60_000 }));
    fs.writeFileSync(`${db}.lock.reclaim`, JSON.stringify({ pid: 2147483000, host: os.hostname(), at: Date.now() - 60_000 }));
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(`${db}.lock.reclaim`, old, old);
    const ack = path.join(dir, "ack-token.txt");
    const bad = path.join(dir, "bad-token.txt");
    const r = start([CHILD("core-txn.cjs"), db, "0", "3", ack, bad, "0"]);
    expect(await r.done).toBe(0);
    expect(lines(bad)).toEqual([]);
    expect(lines(ack)).toHaveLength(3);
  }, 60_000);

  it("a live holder is NEVER displaced, even after the wait budget: the waiter fails with BUSY and writes nothing", async () => {
    const holder = start([CHILD("lock-holder.cjs"), db]);
    await until(() => holder.out().includes("HELD"), 15_000, "the holder to take the lock");
    const holderId = JSON.parse(fs.readFileSync(`${db}.lock`, "utf8")).ownerId;

    const ack = path.join(dir, "ack.txt");
    const bad = path.join(dir, "violations.txt");
    const waiter = start([CHILD("core-txn.cjs"), db, "9", "2", ack, bad], { SANDC_DATASTORE_LOCK_WAIT_MS: "700" });
    await waiter.done;
    expect(lines(ack)).toEqual([]);
    expect(lines(bad).every((l) => l.startsWith("ERR") && l.includes("DATASTORE_BUSY"))).toBe(true);
    expect(lines(bad)).toHaveLength(2);
    expect(JSON.parse(fs.readFileSync(`${db}.lock`, "utf8")).ownerId).toBe(holderId);
    expect(fs.existsSync(db)).toBe(false); // the waiter wrote nothing
  }, 60_000);

  it("SIGKILL of writers at random points never leaves an unreadable file, and every ACKNOWLEDGED update survives (6 rounds)", async () => {
    for (let round = 0; round < 6; round++) {
      const rdir = fs.mkdtempSync(path.join(dir, "round-"));
      const rdb = path.join(rdir, "db.json");
      const ackA = path.join(rdir, "ackA.txt");
      const ackB = path.join(rdir, "ackB.txt");
      const a = start([CHILD("crash-writer.cjs"), rdb, "A", ackA]);
      const b = start([CHILD("crash-writer.cjs"), rdb, "B", ackB]);
      await until(() => lines(ackA).length + lines(ackB).length > 30, 30_000, "writers to make progress");
      await new Promise((r) => setTimeout(r, Math.random() * 400));
      a.child.kill("SIGKILL"); // dies at an arbitrary point, possibly mid-write, possibly holding the lock
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 300)); // B keeps committing through A's death
      b.child.kill("SIGKILL");
      await Promise.all([a.done, b.done]);

      const doc = JSON.parse(fs.readFileSync(rdb, "utf8")) as { items: string[] };
      const present = new Set(doc.items);
      expect(present.size).toBe(doc.items.length); // no duplicates
      for (const id of [...lines(ackA), ...lines(ackB)]) expect(present.has(id), `round ${round}: acknowledged ${id} must survive`).toBe(true);

      // and a fresh process can carry on straight away (stale lock and any orphan temp file are recovered)
      const rack = path.join(rdir, "rack.txt");
      const rbad = path.join(rdir, "rbad.txt");
      const next = start([CHILD("core-txn.cjs"), rdb, "R", "5", rack, rbad]);
      expect(await next.done).toBe(0);
      expect(lines(rbad)).toEqual([]);
      expect(lines(rack)).toHaveLength(5);
      const after = JSON.parse(fs.readFileSync(rdb, "utf8")) as { items: string[] };
      for (let k = 0; k < 5; k++) expect(after.items).toContain(`wR-${k}`);
    }
  }, 180_000);
});

describe("reader and writer overlap", () => {
  it("lock-free readers never see a partial file or a version going backwards while a writer replaces it continuously", async () => {
    const ack = path.join(dir, "ack.txt");
    const writer = start([CHILD("crash-writer.cjs"), db, "W", ack]);
    await until(() => fs.existsSync(db) && lines(ack).length > 3, 30_000, "the writer to start");
    const readers = Array.from({ length: 3 }, () => start([CHILD("raw-reader.cjs"), db, "2500"]));
    await Promise.all(readers.map((r) => r.done));
    writer.child.kill("SIGKILL");
    await writer.done;
    for (const r of readers) {
      const result = JSON.parse(r.out().trim().split("\n").pop()!);
      expect(result.errors, r.out()).toBe(0);
      expect(result.backwards).toBe(0);
      expect(result.reads).toBeGreaterThan(50);
    }
  }, 120_000);
});
