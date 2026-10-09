/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS script run directly with `node`; it has no ES module syntax to import with. */
// Where scripts/seed.js is allowed to write. Kept separate so it can be tested without running the seed.
//
// One contract, the same one the rest of the project already documents:
//   1. GYM_DB_PATH       an explicit db file. Used by the other scripts in this folder and by their tests.
//   2. DATA_DIR          <DATA_DIR>/db.json. What the running app uses (lib/db.ts), so a staging operator who exports
//                        the same DATA_DIR for the app and for the seed targets the same file.
//   3. SANDC_APP_CONFIG  its `dataDir=` entry, which lib/app-config.ts honours below DATA_DIR on hosts where a plain
//                        DATA_DIR variable cannot be set. Only that one key is read; nothing else in the value is used.
//   4. default           <repository>/data/db.json, resolved from this script's own location, NOT from the current
//                        working directory, so starting the script from another folder cannot redirect or scatter the write.
//
// The first rule that is set wins. A relative path is resolved against the working directory, as the shell would. The
// target must be a .json file and must not be an existing directory, so a typo such as GYM_DB_PATH=/some/dir or a path to
// an unrelated file type is refused instead of overwritten. Only the target's own parent folder is ever created.

const fs = require("fs");
const path = require("path");

function dataDirFromAppConfig(raw) {
  if (!raw || !raw.trim()) return null;
  for (const pair of raw.split("|")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === "dataDir") return pair.slice(eq + 1).trim() || null;
  }
  return null;
}

function assertSafeTarget(dbPath, source, checkExisting) {
  if (path.extname(dbPath).toLowerCase() !== ".json") {
    throw new Error(`Refusing to seed ${dbPath} (from ${source}): the target must be a .json file.`);
  }
  if (!checkExisting) return;
  let stat = null;
  try {
    stat = fs.statSync(dbPath);
  } catch {
    // Not there yet: fine, it will be created.
  }
  if (stat && stat.isDirectory()) {
    throw new Error(`Refusing to seed ${dbPath} (from ${source}): it is a directory, not a db file.`);
  }
}

/** Resolves the datastore file the seed will replace. Returns { dbPath, source } or throws. */
function resolveSeedTarget(env, scriptDir) {
  const explicit = env.GYM_DB_PATH && env.GYM_DB_PATH.trim();
  const dataDir = env.DATA_DIR && env.DATA_DIR.trim();
  const configDir = dataDirFromAppConfig(env.SANDC_APP_CONFIG);

  let target;
  if (explicit) target = { dbPath: path.resolve(explicit), source: "GYM_DB_PATH" };
  else if (dataDir) target = { dbPath: path.join(path.resolve(dataDir), "db.json"), source: "DATA_DIR" };
  else if (configDir) target = { dbPath: path.join(path.resolve(configDir), "db.json"), source: "SANDC_APP_CONFIG dataDir" };
  else target = { dbPath: path.resolve(scriptDir, "..", "data", "db.json"), source: "default (repository data/ folder)" };

  // The built-in default is a known file name, so it is never even looked at here. Only a path someone typed is checked.
  assertSafeTarget(target.dbPath, target.source, !target.source.startsWith("default"));
  return target;
}

module.exports = { resolveSeedTarget, dataDirFromAppConfig };
