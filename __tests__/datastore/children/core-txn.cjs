/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS child process run directly with node */
// Child process: runs read-modify-write TRANSACTIONS through the production core, one per synchronous turn, the way lib/db.ts does.
//   node core-txn.cjs <dbPath> <workerId> <count> <ackFile> <violationFile> [gapMs]
// Every transaction appends a unique id to `items`. After a commit returns, the id is appended to ackFile (an acknowledged write).
// Inside the critical section the child takes an exclusive "inside" marker; if another process is inside at the same time the marker create fails,
// which is recorded in violationFile: that is a direct detector for two live writers, not an inference from the final contents.
const fs = require("node:fs");
const core = require("../../../lib/datastore/core.js");

const [dbPath, id, countStr, ackFile, violationFile, gapStr] = process.argv.slice(2);
const count = Number(countStr);
const gap = Number(gapStr || 0);
const inside = `${dbPath}.inside-marker`;
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  let errors = 0;
  for (let k = 0; k < count; k++) {
    const opId = `w${id}-${k}`;
    try {
      const { text, epoch } = core.readInTurn(dbPath, { allowNew: true });
      let marker = null;
      try {
        marker = fs.openSync(inside, "wx");
      } catch {
        fs.appendFileSync(violationFile, `${opId}\n`);
      }
      const db = text === null ? { items: [], counter: 0 } : JSON.parse(text);
      db.items.push(opId);
      db.counter += 1;
      core.writeInTurn(dbPath, JSON.stringify(db), epoch);
      if (marker !== null) {
        fs.closeSync(marker);
        try {
          fs.unlinkSync(inside);
        } catch {
          /* ignore */
        }
      }
      fs.appendFileSync(ackFile, `${opId}\n`);
    } catch (e) {
      errors++;
      fs.appendFileSync(violationFile, `ERR ${opId} ${e.code ?? ""} ${String(e.message).slice(0, 60)}\n`);
    }
    await tick();
    if (gap > 0) await new Promise((r) => setTimeout(r, Math.random() * gap));
  }
  process.stdout.write(`done errors=${errors}\n`);
})();
