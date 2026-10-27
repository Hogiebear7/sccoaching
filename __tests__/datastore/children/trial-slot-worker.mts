// Child process: asks for a claim on trial capacity on the shared datastore. node --import tsx trial-slot-worker.mts <userId> <perTrialUsd> <trialPoolUsd>
// (DATA_DIR comes from the environment.) Prints granted=1 or granted=0.
import { reserveTrialSlot } from "../../../lib/db";

const [userId, perTrial, pool] = process.argv.slice(2);
const r = reserveTrialSlot({ userId, perTrialUsd: Number(perTrial), trialPoolUsd: Number(pool), paidPoolUsd: 0, ceilingUsd: 1000, ttlMs: 600_000, isLiveEntitlement: () => false });
process.stdout.write(`granted=${r.ok ? 1 : 0}\n`);
