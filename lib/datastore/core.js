/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS on purpose: the operator scripts (scripts/*.mjs, seed.js) load this same file with node, so the app and the scripts cannot drift apart. */
"use strict";

// Datastore primitives for the single-file JSON datastore (<DATA_DIR>/db.json).
//
// WHY THIS EXISTS. The datastore is one JSON file that every request reads whole and rewrites whole. That is only correct with exactly one writer at
// a time. The host cannot promise one process (and a redeploy can overlap two), so this file makes the persistence layer safe when several processes
// share the file. It does NOT change the file's format, and it does not make the application distributed.
//
// WHAT IT GUARANTEES (see docs/datastore-hardening-2026-10.md for the full list and the tests):
//  1. Mutual exclusion across processes on one host: a cross-process lock file (`<db>.lock`) is held for the whole synchronous TURN in which the app
//     touches the datastore (every lib/db.ts function is synchronous), so read-latest, modify and write form one transaction, and so do the several
//     db calls a route makes between two `await`s.
//  2. No stale snapshot can be written: a snapshot is only valid inside the turn that read it. Writing one from an earlier turn throws instead of
//     overwriting another process's changes.
//  3. Atomic replacement: the new file is written next to the old one (same directory, so same filesystem), fsynced, and renamed over it. A reader
//     sees the old file or the new file, never a mixture.
//  4. Fencing: at commit time the file must still be the file this process last read or wrote (device, inode, size, mtime, ctime). If it is not (for
//     example the lock was wrongly taken over), the commit throws and nothing is overwritten.
//  5. A lock is only taken over when its owner is provably dead (same host, process gone, or the pid now belongs to a different process). A live
//     holder is NEVER displaced: after the wait budget the caller gets DATASTORE_BUSY. So a timeout can never create two live writers.
//  6. A missing datastore is never silently replaced by a new empty one once it has existed (marker file), and in production only an explicit
//     SANDC_ALLOW_NEW_DATASTORE=1 permits first-time creation. A malformed file throws and is never overwritten.
//
// ASSUMPTIONS AND LIMITS (also documented, and several are verified by tests):
//  - One host, one filesystem. `open(O_EXCL)`, `rename` and `link` must be atomic on that filesystem (true for local disks and for typical container
//    volumes; NOT guaranteed on some network filesystems). If lock owners come from another host, liveness cannot be judged and the lock is never taken over.
//  - Node has no flock and no conditional rename, so the lock is a lock FILE. The fencing check narrows, but cannot completely remove, the window in
//    which a wrongly displaced holder could race a rename. That window needs a lock takeover from a process that was actually alive AND a commit inside
//    microseconds; the takeover rule above makes the first condition require a pid-reuse or clock fault.
//  - Durability: the file and (on POSIX) its directory are fsynced, so an acknowledged write survives a process crash and normally a power loss. Disks
//    that lie about fsync are out of scope.
//  - A read-modify-write that spans an `await` (read in one turn, write a value derived from it in a later turn) is not made atomic by a file lock. It
//    already races between two requests in ONE process. The hardening does not make it worse and does not hide it: writing a snapshot from an older
//    turn throws.
//  - The lock is held for a synchronous turn, so a very long synchronous section blocks other processes' datastore access until it ends (they wait up
//    to the wait budget). Waiting blocks that process's event loop (Atomics.wait); the holder never waits on anyone, so there is no deadlock.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const LOCK_WAIT_MS = Number(process.env.SANDC_DATASTORE_LOCK_WAIT_MS) || 10_000;
// A lock file that exists but has no parseable owner is "being written" only for this long, then it is treated as garbage.
const PARTIAL_LOCK_GRACE_MS = 2_000;
const MARKER_NAME = ".datastore-initialised";

class DatastoreError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "DatastoreError";
    this.code = code;
  }
}

// Windows reports EPERM/EBUSY/EACCES for a file that another process has just deleted but whose handle is not yet closed ("delete pending"). On that
// platform these mean "try again"; elsewhere they are real errors and are never retried.
const transient = (e) => process.platform === "win32" && ["EPERM", "EBUSY", "EACCES"].includes(e.code);

const sleepCell = new Int32Array(new SharedArrayBuffer(4));
const sleepSync = (ms) => Atomics.wait(sleepCell, 0, 0, ms);

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM"; // exists, owned by someone else
  }
}

/** Linux process start time (field 22 of /proc/<pid>/stat), used to tell a reused pid from the original owner. null where unavailable. */
function procStartTime(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return rest[19] ?? null;
  } catch {
    return null;
  }
}

const HOST = os.hostname();
const MY_START = procStartTime(process.pid);

// State shared by EVERY module instance in this process. Next.js can load lib/db.ts more than once (separate server bundles); each instance must see
// the same held lock or one instance would wait, blocking the event loop, for a lock its sibling instance can only release from that same loop.
const REGISTRY_KEY = Symbol.for("sandc.datastore.registry");
function registry() {
  if (!globalThis[REGISTRY_KEY]) globalThis[REGISTRY_KEY] = { held: new Map(), epoch: 0, liveOwnerIds: new Set(), lastCommit: new Map(), foreignWrites: 0 };
  return globalThis[REGISTRY_KEY];
}

function newOwner() {
  return { ownerId: crypto.randomBytes(8).toString("hex"), pid: process.pid, host: HOST, procStart: MY_START, takenAt: Date.now() };
}

/** Reads and parses a lock file. Returns { owner|null, ageMs } or null if the file is gone. */
function inspectLock(lockPath) {
  let text;
  let ageMs = 0;
  try {
    text = fs.readFileSync(lockPath, "utf8");
    ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
  } catch (e) {
    if (e.code === "ENOENT" || transient(e)) return null;
    throw e;
  }
  try {
    const owner = JSON.parse(text);
    if (owner && typeof owner.ownerId === "string" && Number.isInteger(owner.pid)) return { owner, ageMs };
  } catch {
    // partial or garbage content
  }
  return { owner: null, ageMs };
}

/** true = provably dead, false = alive, null = cannot tell (so it must be treated as alive). */
function ownerDead(owner) {
  if (owner.host !== HOST) return null;
  if (owner.pid === process.pid) return !registry().liveOwnerIds.has(owner.ownerId); // our own pid but not a lock we currently hold: a leftover
  if (!pidAlive(owner.pid)) return true;
  if (owner.procStart) {
    const now = procStartTime(owner.pid);
    if (now && now !== owner.procStart) return true; // pid reused by a different process
  }
  return false;
}

// A reclaim token older than this belongs to a process that died in the middle of a reclaim (which takes microseconds), so it may be cleared.
const RECLAIM_TOKEN_STALE_MS = 5_000;

/**
 * Removes a DEAD owner's lock file. Returns true if it did something (or the lock was already gone), false if it did not act and the caller should look again.
 *
 * Only one process at a time may reclaim: it must first create an exclusive reclaim token beside the lock. While the token is held nobody else can remove a lock, and
 * nobody can CREATE one either (the dead owner's file is still in place), so what the reclaimer re-inspects under the token is what it removes. Without the token, two
 * processes that both saw the dead lock could each move "the" lock aside, the second one moving a live lock the first process had just created, and for a moment two
 * processes believed they held it (found by a stress run on Windows: overlapping critical sections and LOCK_LOST errors after a holder was killed).
 */
function reclaim(lockPath, seen) {
  const tokenPath = `${lockPath}.reclaim`;
  try {
    const fd = fs.openSync(tokenPath, "wx", 0o600);
    try {
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, host: HOST, at: Date.now() }));
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    if (e.code === "EEXIST") {
      // Someone else is reclaiming right now. If its token is old it died mid-reclaim: clear it so the next attempt can proceed.
      try {
        if (Date.now() - fs.statSync(tokenPath).mtimeMs > RECLAIM_TOKEN_STALE_MS) fs.unlinkSync(tokenPath);
      } catch {
        /* gone or busy: the next attempt will see */
      }
      return false;
    }
    if (transient(e)) return false;
    throw e;
  }
  try {
    const again = inspectLock(lockPath);
    if (again === null) return true; // already gone
    // Still the very lock we judged dead (same owner, or still unparseable)?
    const same = seen.owner ? !!again.owner && again.owner.ownerId === seen.owner.ownerId : !again.owner;
    if (!same) return false;
    const grave = `${lockPath}.dead-${crypto.randomBytes(6).toString("hex")}`;
    try {
      fs.renameSync(lockPath, grave);
    } catch (e) {
      if (e.code === "ENOENT") return true;
      if (transient(e)) return false;
      throw e;
    }
    for (let attempt = 0; ; attempt++) {
      try {
        fs.unlinkSync(grave);
        break;
      } catch (e) {
        if (e.code === "ENOENT") break;
        if (!transient(e) || attempt >= 20) break; // a leftover grave is harmless: nothing reads it
        sleepSync(5);
      }
    }
    return true;
  } finally {
    try {
      fs.unlinkSync(tokenPath);
    } catch {
      /* ignore */
    }
  }
}

function acquireLock(dbPath) {
  const lockPath = `${dbPath}.lock`;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const owner = newOwner();
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeSync(fd, JSON.stringify(owner));
      } finally {
        fs.closeSync(fd);
      }
      registry().liveOwnerIds.add(owner.ownerId);
      return owner;
    } catch (e) {
      if (transient(e)) {
        if (Date.now() > deadline) throw new DatastoreError("DATASTORE_BUSY", `The datastore lock could not be opened (${e.code}) within the wait budget.`);
        sleepSync(1 + Math.random() * 4);
        continue;
      }
      if (e.code !== "EEXIST") throw e;
    }
    const seen = inspectLock(lockPath);
    if (seen === null) continue; // vanished between our attempt and the inspection
    const dead = seen.owner ? ownerDead(seen.owner) : seen.ageMs > PARTIAL_LOCK_GRACE_MS ? true : false;
    if (dead === true) {
      if (!reclaim(lockPath, seen)) sleepSync(1 + Math.random() * 3);
      continue;
    }
    if (Date.now() > deadline) {
      const who = seen.owner ? `pid ${seen.owner.pid} on ${seen.owner.host}, held ${Math.round(Date.now() - seen.owner.takenAt)} ms` : "an unreadable lock file";
      throw new DatastoreError("DATASTORE_BUSY", `The datastore lock is held by ${who}. It was not taken over because the holder is not known to be dead.`);
    }
    sleepSync(1 + Math.random() * 4);
  }
}

function lockStillOurs(dbPath, owner) {
  const seen = inspectLock(`${dbPath}.lock`);
  return !!seen && !!seen.owner && seen.owner.ownerId === owner.ownerId;
}

function releaseLock(dbPath, owner) {
  registry().liveOwnerIds.delete(owner.ownerId);
  const lockPath = `${dbPath}.lock`;
  // Called from a microtask at the end of a turn: it must never throw, or it would take the process down. A lock that cannot be removed now is left
  // for the stale-owner rule (or the next release) to clear, and the caller's data is already safely committed.
  try {
    const seen = inspectLock(lockPath);
    if (seen && seen.owner && seen.owner.ownerId === owner.ownerId) {
      for (let attempt = 0; ; attempt++) {
        try {
          fs.unlinkSync(lockPath);
          return;
        } catch (e) {
          if (e.code === "ENOENT") return;
          if (!transient(e) || attempt >= 20) throw e;
          sleepSync(5);
        }
      }
    }
  } catch (e) {
    process.stderr.write(`[datastore] could not remove lock file ${lockPath}: ${e.code ?? e.message}
`);
  }
}

/** The identity of the file on disk: changes on every atomic replacement. */
function identityOf(dbPath) {
  try {
    const st = fs.statSync(dbPath, { bigint: true });
    return `${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`;
  } catch (e) {
    if (e.code === "ENOENT") return "absent";
    throw e;
  }
}

function fsyncDir(dir) {
  if (process.platform === "win32") return;
  let fd;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch {
    /* some filesystems refuse to fsync a directory; the file itself is already synced */
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      // Windows refuses to replace a file another process has open; retry briefly. POSIX never gets here.
      if (!["EPERM", "EBUSY", "EACCES"].includes(e.code) || attempt >= 50) throw e;
      sleepSync(10);
    }
  }
}

/** Writes `text` to a temporary file in the SAME directory, fsyncs it, and renames it over `dbPath`. */
function atomicReplace(dbPath, text) {
  const dir = path.dirname(dbPath);
  let mode = 0o600;
  try {
    mode = fs.statSync(dbPath).mode & 0o777;
  } catch {
    /* new file */
  }
  const tmp = path.join(dir, `.${path.basename(dbPath)}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`);
  const fd = fs.openSync(tmp, "wx", mode);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } catch (e) {
    fs.closeSync(fd);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
  fs.closeSync(fd);
  try {
    renameWithRetry(tmp, dbPath);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
  fsyncDir(dir);
  removeOrphanTemps(dbPath);
}

/** A process killed between creating and renaming its temporary file leaves it behind. Remove only temp files whose owning process is provably gone. */
function removeOrphanTemps(dbPath) {
  const dir = path.dirname(dbPath);
  const prefix = `.${path.basename(dbPath)}.tmp-`;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const pid = Number(name.slice(prefix.length).split("-")[0]);
    if (!Number.isInteger(pid) || pid === process.pid || pidAlive(pid)) continue;
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch {
      /* already gone */
    }
  }
}

function ensureMarker(dir) {
  const marker = path.join(dir, MARKER_NAME);
  try {
    fs.writeFileSync(marker, JSON.stringify({ createdAt: new Date().toISOString(), note: "This directory holds a datastore. If db.json is missing while this file exists, the datastore was lost: restore it from a backup, do not start empty." }), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
}

/** Decides what a missing db.json means. Returns normally only when creating a new empty datastore is explicitly allowed. */
function assertMayStartEmpty(dbPath, allowNew) {
  if (fs.existsSync(path.join(path.dirname(dbPath), MARKER_NAME))) {
    throw new DatastoreError("DATASTORE_MISSING", `The datastore file ${dbPath} is missing but this directory has held a datastore before. Refusing to start with an empty one. Restore db.json from a backup.`);
  }
  if (!allowNew) {
    throw new DatastoreError("DATASTORE_NOT_INITIALISED", `No datastore at ${dbPath}. Refusing to create an empty one in production by accident (wrong DATA_DIR?). If this is a brand-new install, set SANDC_ALLOW_NEW_DATASTORE=1 once.`);
  }
}

/** Parses datastore text. Never returns a default for bad input. */
function parseDatastoreText(text, dbPath) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new DatastoreError("DATASTORE_CORRUPT", `The datastore ${dbPath} is not valid JSON (${text.length} bytes): ${e.message.slice(0, 80)}. Nothing was changed. Restore a backup.`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DatastoreError("DATASTORE_CORRUPT", `The datastore ${dbPath} is valid JSON but not an object. Nothing was changed. Restore a backup.`);
  }
  return parsed;
}

// ── turn-scoped access for the application ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Takes (or re-uses) the cross-process lock for the current synchronous turn. It is released automatically when the turn ends. */
function holdForTurn(dbPath) {
  const reg = registry();
  let h = reg.held.get(dbPath);
  if (h) return h;
  const owner = acquireLock(dbPath);
  h = { owner, epoch: ++reg.epoch, identity: null };
  reg.held.set(dbPath, h);
  queueMicrotask(() => {
    if (reg.held.get(dbPath) === h) reg.held.delete(dbPath);
    releaseLock(dbPath, owner);
  });
  return h;
}

/**
 * DETECTION ONLY. Every commit by this protocol replaces the file (a new inode). An OLD, unlocked build rewrites db.json IN PLACE (same inode, new content). So if the file
 * this process last committed still has the same inode but different content or timestamps, something that does not take the lock has written to it: most likely an old
 * build that was started again against this directory. The data we just read is the latest, so the request carries on, but the lock protects nothing from that writer and
 * a person must be told. (An inode number can in rare cases be reused by another hardened process's replacement; the message says "possible".)
 */
function noteForeignWrite(dbPath, identity) {
  const reg = registry();
  const last = reg.lastCommit.get(dbPath);
  if (!last || last === identity) return;
  const [dev1, ino1] = last.split(":");
  const [dev2, ino2] = identity.split(":");
  if (dev1 === dev2 && ino1 === ino2) {
    reg.foreignWrites++;
    reg.lastCommit.set(dbPath, identity);
    process.stderr.write(`[datastore] WARNING (possible foreign write): ${dbPath} was changed in place since this process last wrote it. Only a writer that does not take the lock does that (an old build run again against this folder?). The lock does not protect against it. Stop it, then check the data.
`);
  }
}

/**
 * Reads the datastore under the turn lock. Returns { text|null, epoch }. `text` is null only when a new empty datastore is explicitly allowed.
 * @param {string} dbPath @param {{ allowNew: boolean }} opts
 */
function readInTurn(dbPath, opts) {
  const h = holdForTurn(dbPath);
  let fd;
  try {
    fd = fs.openSync(dbPath, "r");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    assertMayStartEmpty(dbPath, opts.allowNew);
    h.identity = "absent";
    return { text: null, epoch: h.epoch };
  }
  try {
    const st = fs.fstatSync(fd, { bigint: true });
    const text = fs.readFileSync(fd, "utf-8");
    h.identity = `${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`;
    noteForeignWrite(dbPath, h.identity);
    return { text, epoch: h.epoch };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Commits `text` as the new datastore. Only valid for a snapshot read in the CURRENT turn, while the lock is still ours, and only if the file
 * on disk is still the one this process last read or wrote.
 * @param {string} dbPath @param {string} text @param {number} epoch
 */
function writeInTurn(dbPath, text, epoch) {
  const h = registry().held.get(dbPath);
  if (!h || h.epoch !== epoch) {
    throw new DatastoreError("STALE_SNAPSHOT", "Refusing to write a datastore snapshot that was read in an earlier turn: it may be missing other processes' changes. Re-read and apply the change again.");
  }
  if (!lockStillOurs(dbPath, h.owner)) {
    throw new DatastoreError("LOCK_LOST", "The datastore lock is no longer held by this process. Nothing was written.");
  }
  const disk = identityOf(dbPath);
  if (disk !== h.identity) {
    throw new DatastoreError("CONFLICT", "The datastore file changed since this process read it. Nothing was written.");
  }
  atomicReplace(dbPath, text);
  ensureMarker(path.dirname(dbPath));
  h.identity = identityOf(dbPath);
  registry().lastCommit.set(dbPath, h.identity);
}

// ── for operator scripts (read once, write once) ──────────────────────────────────────────────────────────────────────────────────────────────

/** Reads the datastore for a script and remembers exactly which file version it saw. Throws on a missing or malformed file; never defaults. */
function readForScript(dbPath) {
  const identityBefore = identityOf(dbPath);
  if (identityBefore === "absent") throw new DatastoreError("DATASTORE_MISSING", `Database not found at ${dbPath}.`);
  const text = fs.readFileSync(dbPath, "utf8");
  const identity = identityOf(dbPath);
  return { db: parseDatastoreText(text, dbPath), token: { identity, bytes: Buffer.byteLength(text) } };
}

/** Writes a script's result atomically, under the lock, and only if the file is still the version the script read. */
function writeForScript(dbPath, db, token) {
  const owner = acquireLock(dbPath);
  try {
    if (token && identityOf(dbPath) !== token.identity) {
      throw new DatastoreError("CONFLICT", "The datastore changed while this script was running (the app or another script wrote it). Nothing was written. Re-run the script.");
    }
    atomicReplace(dbPath, JSON.stringify(db, null, 2));
    ensureMarker(path.dirname(dbPath));
  } finally {
    releaseLock(dbPath, owner);
  }
}

/** Atomic, locked write of text to a datastore path (used by seeds that create or replace the file). */
function writeTextForScript(dbPath, text) {
  const owner = acquireLock(dbPath);
  try {
    atomicReplace(dbPath, text);
    ensureMarker(path.dirname(dbPath));
  } finally {
    releaseLock(dbPath, owner);
  }
}

/**
 * Runs `fn` while holding the same cross-process lock protocol the datastore uses, but for a DIFFERENT file (a small side file such as the job-run lease or the shared
 * rate-limit counters). `fn` must be synchronous and short. Same guarantees: a live holder is never displaced, a dead one is taken over, a wait that runs out
 * throws DATASTORE_BUSY. Use replaceFileAtomically(path, text) to write that side file.
 */
function withFileLock(filePath, fn) {
  const owner = acquireLock(filePath);
  try {
    return fn();
  } finally {
    releaseLock(filePath, owner);
  }
}

module.exports = {
  DatastoreError,
  withFileLock,
  replaceFileAtomically: atomicReplace,
  MARKER_NAME,
  readInTurn,
  writeInTurn,
  parseDatastoreText,
  readForScript,
  writeForScript,
  writeTextForScript,
  // exposed for tests only
  _foreignWriteCount: () => registry().foreignWrites,
  _acquireLock: acquireLock,
  _releaseLock: releaseLock,
  _identityOf: identityOf,
  _atomicReplace: atomicReplace,
};
