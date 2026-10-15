/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS child process run directly with node */
// Child process: commits transactions in a loop until killed (the test uses SIGKILL). Acknowledged ids go to the ack file AFTER the commit returned.
const fs = require("node:fs");
const core = require("../../../lib/datastore/core.js");
const [dbPath, id, ackFile] = process.argv.slice(2);
const tick = () => new Promise((r) => setImmediate(r));
(async () => {
  for (let k = 0; ; k++) {
    const opId = `c${id}-${k}`;
    const { text, epoch } = core.readInTurn(dbPath, { allowNew: true });
    const db = text === null ? { items: [], pad: "x".repeat(20000) } : JSON.parse(text);
    db.items.push(opId);
    core.writeInTurn(dbPath, JSON.stringify(db), epoch);
    fs.appendFileSync(ackFile, `${opId}\n`);
    await tick();
  }
})();
