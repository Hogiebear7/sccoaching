// Child process: asks for AI budget holds on the shared datastore. node --import tsx allowance-worker.mts <userId> <budgetUsd> <reserveUsd> <attempts> <settleActualUsd|none>
// (DATA_DIR comes from the environment.) Prints how many holds this process was granted.
import { randomUUID } from "node:crypto";

import { reserveAiBudget, settleAiReservation } from "../../../lib/db";

const [userId, budgetStr, reserveStr, attemptsStr, settleStr] = process.argv.slice(2);
let granted = 0;
for (let i = 0; i < Number(attemptsStr); i++) {
  const r = reserveAiBudget({ userId, feature: "coach_chat", kind: "paid", reserveUsd: Number(reserveStr), budgetUsd: Number(budgetStr), windowMs: 30 * 86_400_000, ttlMs: 300_000 });
  if (r.ok) {
    granted++;
    if (settleStr !== "none") {
      settleAiReservation(r.id, {
        id: randomUUID(), userId, feature: "coach_chat", model: "claude-opus-4-8", inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1,
        costUsd: Number(settleStr), allowanceKind: "paid", createdAt: new Date().toISOString(),
      });
    }
  }
  await new Promise((r2) => setImmediate(r2));
}
process.stdout.write(`granted=${granted}\n`);
