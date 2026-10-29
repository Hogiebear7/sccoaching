// Behaviour that must hold across PROCESSES, not just inside one: the housekeeping run lease (jobs must not run twice at once) and the shared rate limiter (N processes
// must enforce ONE limit). Real separate OS processes, a real datastore directory, expected counts checked exactly.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CHILD = (name: string) => path.join(ROOT, "__tests__", "datastore", "children", name);
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "datastore-shared-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function run(script: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", CHILD(script), ...args], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, SANDC_RATE_LIMIT_SHARED: "1", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

describe("shared rate limiter", () => {
  it("6 processes hitting the same key 10 times each with a limit of 7: exactly 7 are allowed in total (not 6 x 7)", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => run("limiter-worker.mts", ["login:victim@example.test", "7", "10"])));
    expect(results.map((r) => r.code)).toEqual(Array(6).fill(0));
    const allowed = results.map((r) => Number(/allowed=(\d+)/.exec(r.out)?.[1])).reduce((a, b) => a + b, 0);
    expect(allowed).toBe(7);
  }, 60_000);

  it("different keys do not share a limit, and the counters survive a process exit", async () => {
    const a = await run("limiter-worker.mts", ["a", "3", "5"]);
    const b = await run("limiter-worker.mts", ["b", "3", "5"]);
    expect([/allowed=(\d+)/.exec(a.out)?.[1], /allowed=(\d+)/.exec(b.out)?.[1]]).toEqual(["3", "3"]);
    const again = await run("limiter-worker.mts", ["a", "3", "5"]);
    expect(/allowed=(\d+)/.exec(again.out)?.[1]).toBe("0"); // the earlier process's counts are still there
  }, 60_000);

  it("clearing a key in one process clears it for every process (a correct sign-in resets the shared login count)", async () => {
    expect(/allowed=(\d+)/.exec((await run("limiter-worker.mts", ["login:a@example.test", "3", "5"])).out)?.[1]).toBe("3");
    expect(/allowed=(\d+)/.exec((await run("limiter-worker.mts", ["login:b@example.test", "3", "5"])).out)?.[1]).toBe("3");
    expect((await run("limiter-worker.mts", ["login:a@example.test", "0", "0", "clear"])).out).toContain("cleared");
    expect(/allowed=(\d+)/.exec((await run("limiter-worker.mts", ["login:a@example.test", "3", "5"])).out)?.[1]).toBe("3");
    expect(/allowed=(\d+)/.exec((await run("limiter-worker.mts", ["login:b@example.test", "3", "5"])).out)?.[1]).toBe("0");
  }, 60_000);

  it("falls back to the process's own counters, instead of failing the request, when the shared file cannot be used", async () => {
    fs.mkdirSync(path.join(dir, "rate-limits.json")); // a directory where the counters file should be
    const r = await run("limiter-worker.mts", ["k", "2", "5"]);
    expect(r.code).toBe(0);
    expect(/allowed=(\d+)/.exec(r.out)?.[1]).toBe("2");
  }, 60_000);

  it("a corrupt counters file is treated as empty, not as an error", async () => {
    fs.writeFileSync(path.join(dir, "rate-limits.json"), "{ not json");
    const r = await run("limiter-worker.mts", ["k", "2", "5"]);
    expect(/allowed=(\d+)/.exec(r.out)?.[1]).toBe("2");
  }, 60_000);
});

describe("housekeeping run lease", () => {
  it("5 processes try to start a run at once: exactly one is allowed, the rest are told it is already running", async () => {
    const ack = path.join(dir, "lease-ack.txt");
    const results = await Promise.all(Array.from({ length: 5 }, () => run("lease-worker.mts", ["1500", ack])));
    expect(results.map((r) => r.code)).toEqual(Array(5).fill(0));
    const lines = fs.readFileSync(ack, "utf8").split("\n").filter(Boolean).sort();
    expect(lines).toEqual(["claimed", "refused", "refused", "refused", "refused"]);
  }, 60_000);

  it("the lease is released when the run ends, and a crashed run's lease expires on its own", async () => {
    const ack = path.join(dir, "lease-ack2.txt");
    await run("lease-worker.mts", ["10", ack]);
    await run("lease-worker.mts", ["10", ack]);
    expect(fs.readFileSync(ack, "utf8").split("\n").filter(Boolean)).toEqual(["claimed", "claimed"]);
    // a lease left by a dead run, already past its expiry, does not block the next run
    fs.writeFileSync(path.join(dir, "job-run-lease"), JSON.stringify({ id: "dead-run", expiresAt: Date.now() - 1000 }));
    await run("lease-worker.mts", ["10", ack]);
    expect(fs.readFileSync(ack, "utf8").split("\n").filter(Boolean).slice(-1)).toEqual(["claimed"]);
    // ...but an unexpired one does
    fs.writeFileSync(path.join(dir, "job-run-lease"), JSON.stringify({ id: "live-run", expiresAt: Date.now() + 60_000 }));
    await run("lease-worker.mts", ["10", ack]);
    expect(fs.readFileSync(ack, "utf8").split("\n").filter(Boolean).slice(-1)).toEqual(["refused"]);
  }, 60_000);
});
