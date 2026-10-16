// The AI allowance reservation across PROCESSES. Real separate OS processes, a real datastore directory, exact counts. The budget is a TEST value.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CHILD = path.join(ROOT, "__tests__", "datastore", "children", "allowance-worker.mts");
const SLOT_CHILD = path.join(ROOT, "__tests__", "datastore", "children", "trial-slot-worker.mts");
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "datastore-allowance-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function worker(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; granted: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", CHILD, ...args], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, granted: Number(/granted=(\d+)/.exec(out)?.[1] ?? NaN), out }));
  });
}

function slotWorker(args: string[]): Promise<{ code: number | null; granted: number }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", SLOT_CHILD, ...args], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, granted: Number(/granted=(\d+)/.exec(out)?.[1] ?? NaN) }));
  });
}

describe("trial capacity claims across processes", () => {
  it("8 processes, 8 different members asking at once for places of 0.25 in a trial pool of 0.75 -> exactly 3 granted", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_v, i) => slotWorker([`member-${i}`, "0.25", "0.75"])));
    expect(results.map((r) => r.code)).toEqual(Array(8).fill(0));
    expect(results.reduce((a, r) => a + r.granted, 0)).toBe(3);
  }, 90_000);
});

describe("atomic AI budget reservation across processes", () => {
  it("6 processes asking 10 times each for holds of 0.10 against a budget of 1.00: exactly 10 are granted in total, never 6 x 10", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => worker(["member-1", "1", "0.1", "10", "none"])));
    expect(results.map((r) => r.code)).toEqual(Array(6).fill(0));
    expect(results.reduce((a, r) => a + r.granted, 0)).toBe(10);
  }, 90_000);

  it("the staff features share ONE pool across processes and users: 6 processes, 6 different staff users, budget 0.50 -> exactly 5 holds of 0.10 in total", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_v, i) => worker([`staff-${i}`, "0.5", "0.1", "10", "none"], { POOL: "1" })));
    expect(results.map((r) => r.code)).toEqual(Array(6).fill(0));
    expect(results.reduce((a, r) => a + r.granted, 0)).toBe(5);
  }, 90_000);

  it("the app-wide ceiling spans members: 6 processes, 6 members each with a 9.00 budget, ceiling 0.70 -> exactly 7 holds of 0.10 in total", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_v, i) => worker([`member-${i}`, "9", "0.1", "10", "none"], { CEILING: "0.7" })));
    expect(results.map((r) => r.code)).toEqual(Array(6).fill(0));
    expect(results.reduce((a, r) => a + r.granted, 0)).toBe(7);
  }, 90_000);

  it("one TRIAL pool across processes and accounts: 6 processes, 6 trial accounts each allowed 9.00, trial pool 0.40 -> exactly 4 holds of 0.10", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_v, i) => worker([`trial-${i}`, "9", "0.1", "10", "none"], { KIND: "trial", CLASS_KINDS: "trial,free", CLASS_POOL: "0.4" }))
    );
    expect(results.map((r) => r.code)).toEqual(Array(6).fill(0));
    expect(results.reduce((a, r) => a + r.granted, 0)).toBe(4);
  }, 90_000);

  it("trial and staff racing paid across processes: with ceiling 1.00 and a paid pool of 0.70, trial plus staff get exactly 3 holds (ceiling minus the paid pool) and paid still gets exactly its 7", async () => {
    const env = { CEILING: "1.0", PROTECT_PAID: "0.7" };
    const trial = Array.from({ length: 3 }, (_v, i) => worker([`trial-${i}`, "9", "0.1", "10", "none"], { ...env, KIND: "trial", CLASS_KINDS: "trial,free", CLASS_POOL: "9" }));
    const staff = Array.from({ length: 3 }, (_v, i) => worker([`staff-${i}`, "9", "0.1", "10", "none"], { ...env, POOL: "1" }));
    const paid = Array.from({ length: 3 }, (_v, i) => worker([`paid-${i}`, "9", "0.1", "10", "none"], { CEILING: "1.0", KIND: "paid", CLASS_KINDS: "paid", CLASS_POOL: "0.7" }));
    const [t, s, p] = await Promise.all([Promise.all(trial), Promise.all(staff), Promise.all(paid)]);
    const sum = (rs: { granted: number }[]) => rs.reduce((a, r) => a + r.granted, 0);
    expect(sum(t) + sum(s)).toBe(3);
    expect(sum(p)).toBe(7);
  }, 120_000);

  it("complimentary has its own pool across processes: 4 processes, pool 0.30 -> exactly 3 holds", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_v, i) => worker([`comp-${i}`, "9", "0.1", "10", "none"], { KIND: "complimentary", CLASS_KINDS: "complimentary", CLASS_POOL: "0.3" }))
    );
    expect(results.reduce((a, r) => a + r.granted, 0)).toBe(3);
  }, 90_000);

  it("holds are per member: another member's holds do not use this member's budget", async () => {
    const [a, b] = await Promise.all([worker(["member-a", "0.3", "0.1", "10", "none"]), worker(["member-b", "0.3", "0.1", "10", "none"])]);
    expect([a.granted, b.granted]).toEqual([3, 3]);
  }, 60_000);

  it("with each call settling at its real (smaller) cost, the recorded total never exceeds the budget even with 6 processes racing", async () => {
    // Each call reserves 0.30 but really costs 0.10: reconciliation frees the difference, so more than 3 calls fit, and the settled total is still within 1.00.
    const results = await Promise.all(Array.from({ length: 6 }, () => worker(["member-2", "1", "0.3", "10", "0.1"])));
    expect(results.map((r) => r.code)).toEqual(Array(6).fill(0));
    const granted = results.reduce((a, r) => a + r.granted, 0);
    expect(granted).toBeGreaterThan(3);
    expect(granted * 0.1).toBeLessThanOrEqual(1 + 1e-9);
    const db = JSON.parse(fs.readFileSync(path.join(dir, "db.json"), "utf8")) as { aiUsageLogs: { costUsd: number }[]; aiReservations: unknown[] };
    expect(db.aiUsageLogs).toHaveLength(granted);
    expect(db.aiReservations).toHaveLength(0);
  }, 90_000);
});
