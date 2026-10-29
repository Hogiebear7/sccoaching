// Child process: hits the shared rate limiter. node --import tsx limiter-worker.mts <key> <limit> <attempts> [clear]   (DATA_DIR and SANDC_RATE_LIMIT_SHARED=1 come from the environment)
// With "clear" it clears the key instead and exits.
import { checkRateLimit, clearRateLimit } from "../../../lib/rate-limit";

const [key, limitStr, attemptsStr, mode] = process.argv.slice(2);
if (mode === "clear") {
  clearRateLimit(key);
  process.stdout.write("cleared\n");
  process.exit(0);
}
let allowed = 0;
for (let i = 0; i < Number(attemptsStr); i++) {
  if (checkRateLimit(key, Number(limitStr), 3_600_000).allowed) allowed++;
  await new Promise((r) => setImmediate(r));
}
process.stdout.write(`allowed=${allowed}\n`);
