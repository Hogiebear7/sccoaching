// Child process: representative APPLICATION operations through the real lib/db.ts (run with tsx). Each iteration performs five different writes across
// five collections, one of which is a true read-modify-write counter (claimIapNotification increments `attempts` on every retry).
//   node --import tsx db-worker.mts <workerId> <count> <ackFile>     (DATA_DIR comes from the environment)
import { appendFileSync } from "node:fs";
import { claimIapNotification, createBooking, createMessage, createUserWithRole, saveFoodEntry } from "../../../lib/db";

const [id, countStr, ackFile] = process.argv.slice(2);
const count = Number(countStr);
const now = new Date().toISOString();
const tick = () => new Promise((r) => setImmediate(r));
const ack = (line: string) => appendFileSync(ackFile, `${line}\n`);

for (let k = 0; k < count; k++) {
  createUserWithRole(`w${id}-${k}@example.test`, "x", "member", null);
  ack(`user:w${id}-${k}@example.test`);
  await tick();
  createBooking({ id: `bk-${id}-${k}`, userId: `u-${id}`, classId: "c-1", createdAt: now } as never);
  ack(`booking:bk-${id}-${k}`);
  await tick();
  createMessage({ id: `msg-${id}-${k}`, memberId: `u-${id}`, senderId: `u-${id}`, body: "hello", createdAt: now } as never);
  ack(`message:msg-${id}-${k}`);
  await tick();
  saveFoodEntry({ id: `fe-${id}-${k}`, userId: `u-${id}`, date: "2026-10-15", mealType: "lunch", name: "x", calories: 1, proteinG: 0, carbsG: 0, fatG: 0, createdAt: now, updatedAt: now } as never);
  ack(`food:fe-${id}-${k}`);
  await tick();
  claimIapNotification("shared-counter");
  ack("counter");
  await tick();
}
process.stdout.write("done\n");
