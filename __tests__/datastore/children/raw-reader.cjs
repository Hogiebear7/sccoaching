// Child process: reads the datastore file directly (no lock, as a lock-free reader or an external tool would) while a writer replaces it, and reports
// parse failures and any version that goes backwards.
/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS child process run directly with node */
const fs = require("node:fs");
const [dbPath, ms] = process.argv.slice(2);
const end = Date.now() + Number(ms);
let reads = 0, errors = 0, backwards = 0, last = -1;
while (Date.now() < end) {
  try {
    const text = fs.readFileSync(dbPath, "utf8");
    const db = JSON.parse(text);
    reads++;
    if (db.items.length < last) backwards++;
    last = db.items.length;
  } catch (e) {
    if (e.code === "ENOENT") continue;
    errors++;
  }
}
process.stdout.write(JSON.stringify({ reads, errors, backwards }) + "\n");
