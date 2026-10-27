// Child process: hits the shared rate limiter. node --import tsx limiter-worker.mts <key> <limit> <attempts>   (DATA_DIR and SANDC_RATE_LIMIT_SHARED=1 come from the environment)
import { checkRateLimit } from "../../../lib/rate-limit";

const [key, limitStr, attemptsStr] = process.argv.slice(2);
let allowed = 0;
for (let i = 0; i < Number(attemptsStr); i++) {
  if (checkRateLimit(key, Number(limitStr), 3_600_000).allowed) allowed++;
  await new Promise((r) => setImmediate(r));
}
process.stdout.write(`allowed=${allowed}\n`);
