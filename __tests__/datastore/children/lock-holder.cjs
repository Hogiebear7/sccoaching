/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS child process run directly with node */
// Child process: takes the datastore lock the way the app does (first access of a turn) and then NEVER ends the turn, so the lock stays held until this
// process is killed. Used to test process death while holding the lock, and that a live holder is never displaced.
const core = require("../../../lib/datastore/core.js");
core.readInTurn(process.argv[2], { allowNew: true });
process.stdout.write("HELD\n");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600000);
