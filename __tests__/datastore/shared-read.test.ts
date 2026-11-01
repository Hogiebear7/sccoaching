// Read-only lookups share one parsed copy of db.json (lib/db.ts readDbShared). It must never hide a change: a write made by this process,
// or by any other process, is seen by the very next lookup. And it must actually be shared: an unchanged file is not read again.
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "datastore-shared-read-"));
  vi.resetModules();
  vi.stubEnv("DATA_DIR", dir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function load() {
  const db = await import("@/lib/db");
  const core = await import("@/lib/datastore/core");
  return { db, core, file: path.join(dir, "db.json") };
}

describe("shared read-only snapshot", () => {
  it("sees this process's own writes on the next lookup", async () => {
    const { db } = await load();
    const user = db.createUser("one@example.test", "hash");
    expect(db.findUserById(user.id)?.email).toBe("one@example.test");
    const second = db.createUser("two@example.test", "hash");
    expect(db.findUserById(second.id)?.email).toBe("two@example.test");
    expect(db.findUserByEmail("one@example.test")?.id).toBe(user.id);
  });

  it("sees another process's write on the next lookup", async () => {
    const { db, core, file } = await load();
    const user = db.createUser("one@example.test", "hash");
    expect(db.findUserById(user.id)).toBeDefined();
    await Promise.resolve(); // this process's turn ends and its lock is released
    // Another process replaces the file (as a script or a second server process would).
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    raw.users[0].email = "renamed@example.test";
    core.writeTextForScript(file, JSON.stringify(raw, null, 2));
    expect(db.findUserById(user.id)?.email).toBe("renamed@example.test");
  });

  it("does not read the file again while it is unchanged, and the shared copy cannot be changed in place", async () => {
    const { db } = await load();
    const user = db.createUser("one@example.test", "hash");
    db.findUserById(user.id); // first lookup after the write parses the file
    const reads = vi.spyOn(fs, "readFileSync");
    for (let i = 0; i < 25; i++) db.findUserById(user.id);
    expect(reads).not.toHaveBeenCalled();
    const found = db.findUserById(user.id)!;
    expect(() => {
      (found as { email: string }).email = "changed@example.test";
    }).toThrow(TypeError);
  });

  it("readInTurn skips the read only for the exact same file", async () => {
    const { db, core, file } = await load();
    db.createUser("one@example.test", "hash");
    const first = core.readInTurn(file, { allowNew: true });
    await Promise.resolve(); // the next turn
    expect(core.readInTurn(file, { allowNew: true }, first.identity)).toMatchObject({ unchanged: true, text: null });
    await Promise.resolve();
    core.writeTextForScript(file, fs.readFileSync(file, "utf8"));
    await Promise.resolve();
    const after = core.readInTurn(file, { allowNew: true }, first.identity);
    expect(after.unchanged).toBe(false);
    expect(after.text).toContain("one@example.test");
  });
});
