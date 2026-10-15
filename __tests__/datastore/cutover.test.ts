// The first-deployment cutover (scripts/datastore-cutover.mjs). The point: an OLD, unlocked writer that is still alive when the data moves must be harmless. After the fence it
// can neither write nor start an empty datastore, no write it was told succeeded is lost, and the data that moves is exactly the retired file.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const TOOL = path.join(ROOT, "scripts", "datastore-cutover.mjs");
const OLD_WRITER = path.join(ROOT, "__tests__", "datastore", "children", "old-writer.cjs");
let base: string;
let oldDir: string;
let newDir: string;
beforeEach(() => {
  base = fs.mkdtempSync(path.join(tmpdir(), "cutover-"));
  oldDir = path.join(base, "data");
  newDir = path.join(base, "data-hardened");
  fs.mkdirSync(oldDir);
  fs.writeFileSync(path.join(oldDir, "db.json"), JSON.stringify({ items: ["seed-1", "seed-2"], users: [{ id: "u1" }] }));
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

const tool = (...args: string[]) => spawnSync(process.execPath, [TOOL, ...args], { cwd: ROOT, encoding: "utf8" });
const retiredFile = () => path.join(oldDir, fs.readdirSync(oldDir).find((n) => n.startsWith("db.json.retired-"))!);
const lines = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean) : []);

describe("preflight and the guard rails", () => {
  it("passes on a clean setup and refuses a non-empty target, the same folder, and an already-fenced source", () => {
    expect(tool("preflight", "--from", oldDir, "--to", newDir).status).toBe(0);
    fs.mkdirSync(newDir);
    fs.writeFileSync(path.join(newDir, "something"), "x");
    expect(tool("preflight", "--from", oldDir, "--to", newDir).status).toBe(1);
    expect(tool("preflight", "--from", oldDir, "--to", oldDir).status).toBe(1);
    fs.rmSync(newDir, { recursive: true });
    expect(tool("fence", "--dir", oldDir, "--confirm-app-stopped", "--settle-ms", "50", "--tries", "4").status).toBe(0);
    expect(tool("preflight", "--from", oldDir, "--to", newDir).status).toBe(1); // db.json is now a directory
  });

  it("refuses to fence without the explicit statement that the app was stopped", () => {
    const r = tool("fence", "--dir", oldDir);
    expect(r.status).toBe(2);
    expect(fs.statSync(path.join(oldDir, "db.json")).isFile()).toBe(true); // nothing was touched
  });

  it("adopt refuses a source that was never fenced, and refuses to overwrite an existing datastore", () => {
    const live = path.join(oldDir, "db.json");
    expect(tool("adopt", "--retired", live, "--to", newDir).status).toBe(1);
    expect(tool("fence", "--dir", oldDir, "--confirm-app-stopped", "--settle-ms", "50", "--tries", "4").status).toBe(0);
    expect(tool("adopt", "--retired", retiredFile(), "--to", newDir).status).toBe(0);
    expect(tool("adopt", "--retired", retiredFile(), "--to", newDir).status).toBe(1); // the target now exists
  });
});

describe("an old writer that is STILL RUNNING when the data moves", () => {
  it("cannot write or recreate anything after the fence; every write it was told succeeded is in the adopted datastore; verify passes", async () => {
    const ack = path.join(base, "ack.txt");
    const err = path.join(base, "err.txt");
    const writer = spawn(process.execPath, [OLD_WRITER, path.join(oldDir, "db.json"), ack, err, "15", "9"], { stdio: "ignore" });
    const exited = new Promise<void>((r) => writer.on("close", () => r()));
    await new Promise((r) => setTimeout(r, 800));
    const successesBefore = lines(ack).length;
    expect(successesBefore).toBeGreaterThan(5); // it really was writing

    const fenced = tool("fence", "--dir", oldDir, "--confirm-app-stopped", "--settle-ms", "400", "--tries", "6");
    expect(fenced.status, fenced.stdout + fenced.stderr).toBe(0);
    const ackAtFence = lines(ack).length;

    await new Promise((r) => setTimeout(r, 1200)); // the old writer keeps trying for a while after the fence
    expect(lines(ack).length).toBe(ackAtFence); // not one more success after the fence
    expect(lines(err).length).toBeGreaterThan(10); // it kept trying and kept failing
    expect(new Set(lines(err).map((l) => l.split(" ")[1]))).toEqual(new Set(["EISDIR"])); // failed closed, not "missing, so start empty"
    expect(fs.statSync(path.join(oldDir, "db.json")).isDirectory()).toBe(true);

    const adopted = tool("adopt", "--retired", retiredFile(), "--to", newDir);
    expect(adopted.status, adopted.stdout + adopted.stderr).toBe(0);
    const items = (JSON.parse(fs.readFileSync(path.join(newDir, "db.json"), "utf8")) as { items: string[] }).items;
    for (const id of lines(ack)) expect(items, `acknowledged write ${id} must survive the move`).toContain(id);
    expect(items).toContain("seed-1");

    const v = tool("verify", "--retired", retiredFile(), "--to", newDir, "--fenced-dir", oldDir);
    expect(v.status, v.stdout + v.stderr).toBe(0);
    await exited;
    writer.kill();
  }, 60_000);

  it("verify FAILS if anything changed the retired file after the fence", async () => {
    expect(tool("fence", "--dir", oldDir, "--confirm-app-stopped", "--settle-ms", "50", "--tries", "4").status).toBe(0);
    expect(tool("adopt", "--retired", retiredFile(), "--to", newDir).status).toBe(0);
    fs.appendFileSync(retiredFile(), " ");
    const v = tool("verify", "--retired", retiredFile(), "--to", newDir, "--fenced-dir", oldDir);
    expect(v.status).toBe(1);
    expect(v.stdout).toContain("CHANGED after the fence");
  });

  it("verify FAILS if something was created inside the fence directory", async () => {
    expect(tool("fence", "--dir", oldDir, "--confirm-app-stopped", "--settle-ms", "50", "--tries", "4").status).toBe(0);
    expect(tool("adopt", "--retired", retiredFile(), "--to", newDir).status).toBe(0);
    fs.writeFileSync(path.join(oldDir, "db.json", "surprise"), "x");
    expect(tool("verify", "--retired", retiredFile(), "--to", newDir, "--fenced-dir", oldDir).status).toBe(1);
  });
});
