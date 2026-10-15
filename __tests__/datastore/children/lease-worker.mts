// Child process: tries to take the housekeeping lease, then holds it for a moment. node --import tsx lease-worker.mts <holdMs> <ackFile>   (DATA_DIR from the environment)
import { appendFileSync } from "node:fs";
import { claimJobRunLease, releaseJobRunLease } from "../../../lib/jobs/lease";

const [holdMs, ackFile] = process.argv.slice(2);
const id = claimJobRunLease();
appendFileSync(ackFile, id ? "claimed\n" : "refused\n");
if (id) {
  await new Promise((r) => setTimeout(r, Number(holdMs)));
  releaseJobRunLease(id);
}
process.stdout.write("done\n");
