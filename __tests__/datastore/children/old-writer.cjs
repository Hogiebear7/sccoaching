/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS child process run directly with node */
// Child process that behaves like the OLD, unlocked build: it looks for db.json with existsSync, reads the whole file, appends an item, and rewrites it with a plain
// writeFileSync, over and over. Every successful rewrite is acknowledged in ackFile; every failure is logged in errFile with its error code.
//   node old-writer.cjs <dbPath> <ackFile> <errFile> <intervalMs> <seconds>
const fs = require("node:fs");
const [db, ackFile, errFile, intervalStr, secondsStr] = process.argv.slice(2);
const end = Date.now() + Number(secondsStr) * 1000;
let n = 0;
const tick = () => {
  if (Date.now() > end) {
    process.stdout.write("done\n");
    return;
  }
  const id = `old-${process.pid}-${n++}`;
  try {
    if (!fs.existsSync(db)) throw Object.assign(new Error("missing"), { code: "MISSING" });
    const data = JSON.parse(fs.readFileSync(db, "utf8"));
    data.items.push(id);
    fs.writeFileSync(db, JSON.stringify(data), "utf8");
    fs.appendFileSync(ackFile, `${id}\n`);
  } catch (e) {
    fs.appendFileSync(errFile, `${id} ${e.code ?? e.name}\n`);
  }
  setTimeout(tick, Number(intervalStr));
};
tick();
