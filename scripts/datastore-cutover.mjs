// FIRST-DEPLOYMENT CUTOVER for the datastore hardening. The old build writes db.json with a plain writeFileSync and ignores every lock, so a hardened process and an old
// process must never write the same datastore. Instead of hoping the old processes have gone, this moves the data to a NEW directory that only the hardened build uses, and
// turns the old directory into a dead end that FAILS CLOSED for any old process (or script) that is still alive:
//
//   fence      the old db.json is renamed to db.json.retired-<UTC stamp> and a DIRECTORY named db.json is put in its place. The old code finds "a file" with existsSync, then
//              readFileSync / writeFileSync on a directory throws EISDIR: a request fails with an error, nothing is written, no empty datastore is ever created. (If db.json were
//              simply missing, the old code would silently start an EMPTY datastore and write it, which is why a directory is used.)
//   adopt      copies the retired file, byte for byte, into the new directory (with the hardened marker), after checking it is stable and parses.
//   verify     compares the new datastore with the retired file and checks the fence is intact. Prints counts only, never content.
//   preflight  read-only checks before any of the above.
//
// Nothing here deletes anything. The retired file stays where it is as the exact state at the moment of the fence. It is NEVER restored over newer data.
//
//   node scripts/datastore-cutover.mjs preflight --from <old DATA_DIR> --to <new DATA_DIR>
//   node scripts/datastore-cutover.mjs fence     --dir <old DATA_DIR> --confirm-app-stopped [--settle-ms 5000] [--tries 6]
//   node scripts/datastore-cutover.mjs adopt     --retired <path to db.json.retired-...> --to <new DATA_DIR>
//   node scripts/datastore-cutover.mjs verify    --retired <path to db.json.retired-...> --to <new DATA_DIR> [--fenced-dir <old DATA_DIR>]
//
// Exit code 0 only when everything asked for passed.
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const core = createRequire(import.meta.url)("../lib/datastore/core.js");

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const has = (name) => rest.includes(name);
const out = (s) => console.log(s);
const fail = (s, code = 1) => {
  console.error(`FAIL  ${s}`);
  process.exit(code);
};
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "Z");

function counts(file) {
  const db = core.parseDatastoreText(fs.readFileSync(file, "utf8"), file);
  const c = {};
  for (const [k, v] of Object.entries(db)) c[k] = Array.isArray(v) ? v.length : typeof v === "object" && v !== null ? `object(${Object.keys(v).length})` : typeof v;
  return c;
}

function describeFile(file) {
  const st = fs.statSync(file);
  return `${st.size} bytes, modified ${st.mtime.toISOString()}, sha256 ${sha256(file)}`;
}

async function preflight() {
  const from = path.resolve(flag("--from") ?? fail("--from <old DATA_DIR> is required", 2));
  const to = path.resolve(flag("--to") ?? fail("--to <new DATA_DIR> is required", 2));
  let bad = 0;
  const ok = (m) => out(`PASS  ${m}`);
  const no = (m) => {
    bad++;
    out(`FAIL  ${m}`);
  };
  const oldDb = path.join(from, "db.json");
  if (!fs.existsSync(oldDb) || !fs.statSync(oldDb).isFile()) no(`${oldDb} is not a regular file (already fenced, or the wrong folder?)`);
  else {
    ok(`old datastore is a regular file: ${describeFile(oldDb)}`);
    try {
      const c = counts(oldDb);
      ok(`it parses; ${Object.keys(c).length} collections (counts: ${JSON.stringify(c)})`);
    } catch (e) {
      no(`it does not parse: ${e.message.slice(0, 100)}`);
    }
  }
  if (fs.existsSync(`${oldDb}.lock`)) no(`a lock file ${oldDb}.lock exists: a hardened build has used this folder, or one is running. Find out why before continuing.`);
  else ok("no lock file beside the old datastore (no hardened build is using it)");
  if (path.resolve(to) === path.resolve(from)) no("--to must be a DIFFERENT folder from --from");
  else if (fs.existsSync(to) && fs.readdirSync(to).length > 0) no(`${to} already exists and is not empty: refusing to adopt into it`);
  else ok(`${to} is new or empty`);
  const parent = path.dirname(to);
  try {
    fs.accessSync(parent, fs.constants.W_OK);
    ok(`parent folder ${parent} is writable`);
    const a = fs.statSync(from).dev;
    const b = fs.statSync(parent).dev;
    if (a === b) ok("old and new folders are on the same filesystem");
    else out(`NOTE  the new folder is on a different filesystem from the old one (fine: the copy is byte-for-byte and verified by hash)`);
  } catch (e) {
    no(`cannot use ${parent}: ${e.code ?? e.message}`);
  }
  out(bad ? `\npreflight: ${bad} problem(s). Do not continue.` : "\npreflight: all checks passed. Also run scripts/check-datastore-filesystem.mjs --dir <the new folder's parent>.");
  process.exit(bad ? 1 : 0);
}

async function fence() {
  const dir = path.resolve(flag("--dir") ?? fail("--dir <old DATA_DIR> is required", 2));
  if (!has("--confirm-app-stopped")) fail("pass --confirm-app-stopped to say the old app has been stopped from the hosting panel (this tool cannot see processes; the fence makes a missed one harmless, not absent)", 2);
  const settleMs = Number(flag("--settle-ms") ?? 5000);
  const tries = Number(flag("--tries") ?? 6);
  const dbFile = path.join(dir, "db.json");
  if (!fs.existsSync(dbFile) || !fs.statSync(dbFile).isFile()) fail(`${dbFile} is not a regular file (already fenced?)`);
  const before = describeFile(dbFile);
  const retired = path.join(dir, `db.json.retired-${stamp()}`);
  if (fs.existsSync(retired)) fail(`${retired} already exists`);
  // The fence. rename is atomic: from this instant a new open of db.json by an old process finds a directory.
  fs.renameSync(dbFile, retired);
  fs.mkdirSync(dbFile, { mode: 0o755 });
  fs.writeFileSync(
    path.join(dbFile, "README.txt"),
    "This directory stands where db.json used to be. It is a deliberate fence: an old (unlocked) build that is still running fails here with an error instead of writing.\nThe data moved on; the retired file beside this folder is the exact state at the moment of the fence. Never restore it over newer data.\n"
  );
  out(`FENCED  ${dbFile} is now a directory; the old file is ${retired}`);
  out(`        at the moment of the fence: ${before.replace(/modified [^,]+, /, "")}`);
  // Settle: a write that was already in flight when the file was renamed keeps going into the retired file. Wait until it has stopped.
  let last = sha256(retired);
  let stable = 0;
  for (let i = 0; i < tries && stable < 2; i++) {
    await sleep(settleMs);
    const now = sha256(retired);
    if (now === last) stable++;
    else {
      out(`NOTE    the retired file changed after the fence (an in-flight write finished): ${last.slice(0, 12)} to ${now.slice(0, 12)}`);
      stable = 0;
      last = now;
    }
  }
  if (stable < 2) fail(`the retired file kept changing for ${tries} checks ${settleMs} ms apart: an old process is still writing into it. The fence is in place (new writes cannot happen); stop that process and run this command's settle check again with: node scripts/datastore-cutover.mjs fence-settle --retired ${retired}`, 3);
  fs.writeFileSync(path.join(dbFile, "FENCE.json"), JSON.stringify({ retired: path.basename(retired), sha256: last, bytes: fs.statSync(retired).size, fencedAt: new Date().toISOString() }, null, 2));
  out(`SETTLED retired file stable for ${stable} consecutive checks: sha256 ${last}`);
  out(`NEXT    node scripts/datastore-cutover.mjs adopt --retired ${retired} --to <new DATA_DIR>`);
}

async function fenceSettle() {
  const retired = path.resolve(flag("--retired") ?? fail("--retired is required", 2));
  const dbFile = path.join(path.dirname(retired), "db.json");
  if (!fs.existsSync(dbFile) || !fs.statSync(dbFile).isDirectory()) fail("the fence directory is not in place");
  let last = sha256(retired);
  for (let i = 0; i < 2; i++) {
    await sleep(Number(flag("--settle-ms") ?? 5000));
    const now = sha256(retired);
    if (now !== last) fail(`still changing (${last.slice(0, 12)} to ${now.slice(0, 12)}): an old process is still writing into the retired file`, 3);
    last = now;
  }
  fs.writeFileSync(path.join(dbFile, "FENCE.json"), JSON.stringify({ retired: path.basename(retired), sha256: last, bytes: fs.statSync(retired).size, fencedAt: new Date().toISOString() }, null, 2));
  out(`SETTLED stable: sha256 ${last}`);
}

async function adopt() {
  const retired = path.resolve(flag("--retired") ?? fail("--retired is required", 2));
  const to = path.resolve(flag("--to") ?? fail("--to <new DATA_DIR> is required", 2));
  if (!fs.existsSync(retired) || !fs.statSync(retired).isFile()) fail(`${retired} is not a file`);
  const fenceMarker = path.join(path.dirname(retired), "db.json");
  if (!fs.existsSync(fenceMarker) || !fs.statSync(fenceMarker).isDirectory()) fail("the old folder is not fenced (db.json is not a directory there). Fence first; adopting from a live datastore could copy a half-written file.");
  if (fs.existsSync(path.join(to, "db.json"))) fail(`${path.join(to, "db.json")} already exists: refusing to overwrite a datastore`);
  const h1 = sha256(retired);
  await sleep(1000);
  if (sha256(retired) !== h1) fail("the retired file changed while being read: an old process is still writing into it", 3);
  const text = fs.readFileSync(retired, "utf8");
  core.parseDatastoreText(text, retired); // throws if it is not a valid datastore
  fs.mkdirSync(to, { recursive: true });
  core.writeTextForScript(path.join(to, "db.json"), text);
  const h2 = sha256(path.join(to, "db.json"));
  if (h1 !== h2) fail(`the copy does not match: ${h1} vs ${h2}`);
  if (sha256(retired) !== h1) fail("the retired file changed during the copy", 3);
  out(`ADOPTED ${path.join(to, "db.json")}: ${describeFile(path.join(to, "db.json"))}`);
  out(`        identical to the retired file (sha256 ${h1}); marker ${core.MARKER_NAME} written`);
  out(`NEXT    deploy the hardened build with DATA_DIR=${to}, then: node scripts/datastore-cutover.mjs verify --retired ${retired} --to ${to} --fenced-dir ${path.dirname(retired)}`);
}

async function verify() {
  const retired = path.resolve(flag("--retired") ?? fail("--retired is required", 2));
  const to = path.resolve(flag("--to") ?? fail("--to is required", 2));
  const fencedDir = path.resolve(flag("--fenced-dir") ?? path.dirname(retired));
  let bad = 0;
  const ok = (m) => out(`PASS  ${m}`);
  const no = (m) => {
    bad++;
    out(`FAIL  ${m}`);
  };
  const newDb = path.join(to, "db.json");
  const rc = counts(retired);
  const nc = counts(newDb);
  const rec = (c) => Object.fromEntries(Object.entries(c).filter(([, v]) => typeof v === "number"));
  const lower = Object.keys(rec(rc)).filter((k) => (rec(nc)[k] ?? 0) < rec(rc)[k]);
  if (lower.length) no(`collections with FEWER records than the retired file: ${lower.join(", ")}`);
  else ok("no collection has fewer records than the retired file (more is expected once the new build takes writes)");
  const sameBytes = sha256(newDb) === sha256(retired);
  out(`INFO  new datastore ${sameBytes ? "is still byte-identical to the retired file (no write has happened yet)" : "has changed since adoption (writes have happened)"}`);
  try {
    const fenceRec = JSON.parse(fs.readFileSync(path.join(fencedDir, "db.json", "FENCE.json"), "utf8"));
    if (sha256(retired) === fenceRec.sha256) ok("the retired file is unchanged since the fence (nothing wrote to the old datastore)");
    else no("the retired file CHANGED after the fence: something wrote to the old datastore. The data in it that is not in the new datastore needs a decision from a person.");
  } catch (e) {
    no(`cannot read the fence record: ${e.code ?? e.message}`);
  }
  if (fs.existsSync(path.join(fencedDir, "db.json")) && fs.statSync(path.join(fencedDir, "db.json")).isDirectory()) {
    const entries = fs.readdirSync(path.join(fencedDir, "db.json")).filter((n) => n !== "README.txt" && n !== "FENCE.json");
    if (entries.length === 0) ok("the fence directory is intact and empty of anything an old process could have created");
    else no(`unexpected entries inside the fence directory: ${entries.join(", ")}`);
  } else no("the old folder's db.json is no longer a fence directory");
  if (fs.existsSync(path.join(to, core.MARKER_NAME))) ok("the new folder has the hardened marker");
  else no("the new folder has no marker file");
  out(bad ? `\nverify: ${bad} problem(s)` : "\nverify: all checks passed");
  process.exit(bad ? 1 : 0);
}

const commands = { preflight, fence, "fence-settle": fenceSettle, adopt, verify };
if (!commands[command]) {
  console.error("usage: node scripts/datastore-cutover.mjs <preflight|fence|fence-settle|adopt|verify> ...   (see the header of this file)");
  process.exit(2);
}
await commands[command]();
