// PREFLIGHT for the datastore hardening: checks, on the filesystem where the datastore will live, the behaviours the lock and the atomic replace rely on.
// It works ONLY inside a new scratch folder that it creates under --dir and removes when done. It never reads, writes or lists db.json or any other file.
//
//   node scripts/check-datastore-filesystem.mjs --dir /path/on/the/same/filesystem/as/DATA_DIR      (for example the parent of DATA_DIR)
//
// Exit code 0 only if every check passes. A FAIL names the assumption that does not hold; do not deploy the hardening until that is understood.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const core = createRequire(import.meta.url)("../lib/datastore/core.js");

const argIndex = process.argv.indexOf("--dir");
if (argIndex < 0 || !process.argv[argIndex + 1]) {
  console.error("usage: node scripts/check-datastore-filesystem.mjs --dir <existing folder on the datastore's filesystem>");
  process.exit(2);
}
const parent = path.resolve(process.argv[argIndex + 1]);
if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
  console.error(`--dir ${parent} is not an existing folder`);
  process.exit(2);
}
const scratch = path.join(parent, `.datastore-fs-check-${crypto.randomBytes(5).toString("hex")}`);
fs.mkdirSync(scratch, { mode: 0o700 });

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });
const runChild = (code, args = []) =>
  new Promise((resolve) => {
    const c = spawn(process.execPath, ["-e", code, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.on("close", (status) => resolve({ status, out: out.trim() }));
  });

try {
  // 1. Exclusive create: exactly one of many simultaneous processes may create the same file (the lock depends on this).
  const target = path.join(scratch, "excl");
  const racers = await Promise.all(
    Array.from({ length: 12 }, () =>
      runChild(`try { require("fs").closeSync(require("fs").openSync(process.argv[1], "wx")); console.log("won"); } catch (e) { console.log(e.code); }`, [target])
    )
  );
  const winners = racers.filter((r) => r.out === "won").length;
  check("exclusive create is atomic across processes (exactly one winner of 12)", winners === 1, `winners=${winners}`);

  // 2. Rename over an existing file is atomic: a concurrent reader never sees a partial file or an older version after a newer one.
  const file = path.join(scratch, "db.json");
  fs.writeFileSync(file, JSON.stringify({ n: 0, pad: "x".repeat(50000) }));
  const reader = runChild(
    `const fs=require("fs");const end=Date.now()+1500;let bad=0,back=0,last=-1,reads=0;while(Date.now()<end){try{const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));reads++;if(d.n<last)back++;last=d.n;}catch(e){if(e.code!=="ENOENT")bad++;}}console.log(JSON.stringify({bad,back,reads}));`,
    [file]
  );
  const writerEnd = Date.now() + 1500;
  let n = 0;
  while (Date.now() < writerEnd) {
    n++;
    core._atomicReplace(file, JSON.stringify({ n, pad: "x".repeat(50000) }));
  }
  const rr = JSON.parse((await reader).out);
  check("a concurrent reader never sees a partial or older-after-newer file during atomic replacement", rr.bad === 0 && rr.back === 0 && rr.reads > 20, `reads=${rr.reads} partial=${rr.bad} backwards=${rr.back} writes=${n}`);

  // 3. The file's identity (used for fencing) changes on every replacement, even for same-size content written back to back.
  core._atomicReplace(file, '{"n":1}');
  const id1 = core._identityOf(file);
  core._atomicReplace(file, '{"n":2}');
  const id2 = core._identityOf(file);
  check("the file identity changes on every atomic replacement (fencing works), even for equal-size content", id1 !== id2, "");

  // 4. fsync of the file and (on POSIX) the directory succeeds.
  let synced = true;
  try {
    const fd = fs.openSync(path.join(scratch, "sync"), "w");
    fs.writeSync(fd, "x");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    if (process.platform !== "win32") {
      const dfd = fs.openSync(scratch, "r");
      fs.fsyncSync(dfd);
      fs.closeSync(dfd);
    }
  } catch (e) {
    synced = false;
    check("fsync of a file and its directory succeeds", false, e.code ?? e.message);
  }
  if (synced) check("fsync of a file and its directory succeeds", true);

  // 5. Process liveness checks work (lock takeover from a dead owner relies on this), and stay on one host.
  const live = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  let aliveOk = false;
  try { process.kill(live.pid, 0); aliveOk = true; } catch { /* not alive */ }
  live.kill("SIGKILL");
  await new Promise((r) => live.on("close", r));
  let deadOk = false;
  try { process.kill(live.pid, 0); } catch (e) { deadOk = e.code === "ESRCH"; }
  check("a live process is detected as alive and a killed one as dead", aliveOk && deadOk, `host=${os.hostname()} platform=${process.platform}`);

  // 6. A full lock-protected transaction round trip through the real core, including lock release.
  const dbp = path.join(scratch, "txn.json");
  const t = core.readInTurn(dbp, { allowNew: true });
  core.writeInTurn(dbp, JSON.stringify({ ok: true }), t.epoch);
  await new Promise((r) => setImmediate(r));
  check("a lock-protected transaction commits and releases its lock", JSON.parse(fs.readFileSync(dbp, "utf8")).ok === true && !fs.existsSync(`${dbp}.lock`), "");
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} check(s) FAILED on ${parent}. Do not rely on the datastore lock here.` : `\nAll ${results.length} checks passed on ${parent}.`);
process.exit(failed ? 1 : 0);
