# Datastore hardening (2026-10): safe sharing of `db.json` between processes

**Status: implemented and tested locally on branch `datastore/hardening-2026-10`. Not merged, not deployed, no production access.**
Read `docs/deployment-operations.md` section 3 first for why this exists: the datastore is one JSON file that every request reads whole and rewrites whole, which is
only correct with one writer at a time, and the host cannot promise one process (a redeploy can also overlap two).

## What changed (and what did not)

- **New:** `lib/datastore/core.js` (plain CommonJS, with `core.d.ts`), used by both `lib/db.ts` and the operator scripts so they cannot drift apart.
- **Changed:** `lib/db.ts` keeps its private `readDb` and `writeDb` (nothing else in `app/` or `lib/` opens `db.json`; there are 292 readers and 141 writers, every one of
  them through these two functions), but they now go through the core. The large read-time normaliser is untouched.
- **Changed:** the 20 operator scripts that wrote `db.json` directly now read once and write with a compare-and-swap under the same lock.
- **Added after review:** (1) writers that sit after a slow `await` (Stripe, AI, programme library) now change the row as it is after the await (`updateSubscription`, `updateTrainingProgram`, `saveTrainingProgramIfUnchanged`, `updateWorkoutSession`), and `scripts/audit-await-gaps.cjs --check` (run by the test suite) requires a written disposition for every flagged function; (2) housekeeping runs under a cross-process **lease** (`lib/jobs/lease.ts`) so two processes or two scheduler calls cannot run the jobs at once; (3) the rate limiter keeps its counters in a side file under the same lock when `NODE_ENV=production` (override `SANDC_RATE_LIMIT_SHARED`), so N processes enforce one limit; (4) lock **reclaim is serialised** with an exclusive reclaim token (a stress run of the process-death test had shown overlapping critical sections and LOCK_LOST in 4 of 30 runs before, 0 of 30 after); (5) `scripts/datastore-cutover.mjs` (preflight, fence, adopt, verify) for the first deployment; (6) detection, not prevention, of a writer that rewrites db.json in place (an old build run again against this folder).
- **Not changed:** the file format, any collection, any route, any record, any permission. No migration. No new dependency.

## Guarantees, and the test that checks each

| # | Guarantee | Checked by |
|---|---|---|
| 1 | One lock covers the whole synchronous turn, so read-latest, modify and write (and the several db calls a route makes between two `await`s) are one transaction across processes | `multiprocess.test.ts` contention (8 processes x 60, a detector for two processes inside the critical section, exact counter); real-app counter test (`claimIapNotification`); `run-multi-server.ps1` |
| 2 | A snapshot is valid only in the turn that read it; writing an older one throws instead of overwriting | `core.test.ts` stale-snapshot tests, including a later turn that holds the lock and sees an unchanged file |
| 3 | Atomic replacement through a temporary file in the same directory, fsynced, then renamed | `core.test.ts` (rename arguments, failure at fsync and at rename leave the old file intact and no temp file); reader-overlap test |
| 4 | Commit-time fencing: if the file is not the one this process last read or wrote, nothing is written | `core.test.ts` "fences the commit" and "lock lost" |
| 5 | A lock is taken over only from a provably dead owner; a live holder is never displaced, so a timeout cannot create two live writers | `core.test.ts` lock recovery (dead, live, other host, reused pid on Linux, unreadable lock); `multiprocess.test.ts` live holder and holder killed |
| 6 | A missing datastore never becomes a silent empty one once it has existed (marker file); in production only an explicit `SANDC_ALLOW_NEW_DATASTORE=1` allows a first creation; a malformed file throws and is never overwritten | `core.test.ts`, `db-boundary.test.ts` |
| 7 | Unknown top-level keys survive a rewrite, so rolling the code back cannot delete data a newer version added | `db-boundary.test.ts` |
| 8 | Rewriting keeps every meaningful existing field | `db-boundary.test.ts` normalisation review on a real fixture datastore |
| 9 | Crash durability: an acknowledged write survives SIGKILL at random points; the file is never unreadable; a fresh process carries on straight away | `multiprocess.test.ts` 6 rounds of random SIGKILL with acknowledgement files |
| 10 | Lock-free readers never see a partial file or a version going backwards | `multiprocess.test.ts` reader overlap |

Mutation testing: each safety property above was broken on purpose (no stale check, no fencing, displace a live holder, non-atomic write, no lock, drop unknown keys, silent
empty datastore, ignore the marker, overwrite a corrupt file) and the suite failed every time. One property (the stale-snapshot check) first survived because the test ended
the turn early; a test for the real scenario was added and the mutation now fails.

## Normalisation on rewrite (reviewed)

Every save rewrites the whole file through the app's read-time normaliser. On a fixture datastore, one ordinary write:
- removes no collection and no record, and reorders nothing;
- keeps every existing field with its value, except the documented legacy conversion (recovery logs on the old 1-5 scale are doubled and flagged `scale10`, which is how they already read);
- **adds** the defaults the app already applied on every read (for example 29 profile fields, `imageUrl` on classes, the six built-in class categories, four settings objects).
  The file therefore grows on its first save (17 KB to 27 KB on the fixture) and is stable afterwards (a second save changes nothing else).
- The one thing the old normaliser did destroy, unknown top-level keys, is now preserved.

## Limitations (read these before approving)

See also `docs/datastore-first-deployment.md` for the cutover procedure that replaces "deploy in a quiet period".

1. **Single host, single filesystem.** The lock needs atomic exclusive create and atomic rename on the filesystem holding `DATA_DIR`. True for local disks and normal container volumes; not
   guaranteed on some network filesystems. Run `node scripts/check-datastore-filesystem.mjs --dir <folder on that filesystem>` on the host first (it uses its own scratch folder and never touches `db.json`).
   Lock owners on another host are never taken over (liveness cannot be judged), so a lock left by a different host needs a person.
2. **No flock in Node.** The lock is a file. If a lock is ever wrongly taken over, the commit-time fence narrows the damage to a microsecond window; it cannot make that window zero.
3. **Check-then-act across an `await` is not made atomic by the lock, and not every instance is fixed.** 20 functions have the shape *await, read, await, write* (a heuristic scan). Each now has a
   disposition in `scripts/audit-await-gaps.cjs`: the ones that wrote a record read before a slow call (subscription pause/resume/override and the checkout switch, programme check-in, adjustment and swap, workout review,
   gym status, workout visibility, nutrition submission review) are FIXED to change the row as it is after the await, and tested by making the slow call perform the competing change. The rest only append new records or
   have only request parsing between their read and write. What remains: a **check-then-act decision** made before an await (for example "is this subscription active?", then a provider call, then an action) can still be
   wrong if another request changes the state in between; the fixed routes re-check the precondition after the await, but a provider side effect (a Stripe call) that already happened cannot be undone by this code.
4. **Rate limit and jobs are now shared across processes on ONE host** (counters in `rate-limits.json`, run lease in `job-run-lease`, both beside db.json, same lock). If the shared file cannot be used, the limiter falls back to
   per-process counters and logs it. Two hosts would still keep separate counters and leases.
5. **Cost.** Each datastore turn takes and releases a lock and fsyncs on write: about 4.3 ms more per request in a local container (6.5 to 10.9 ms for 242 sequential requests). A long synchronous
   section holds other processes off until it ends; they wait up to 10 s (`SANDC_DATASTORE_LOCK_WAIT_MS`) and then fail that request with `DATASTORE_BUSY`.
6. **Windows** (development only): rename and delete can transiently fail while another process has the file open; the core retries those. Production is Linux.
7. **The first deployment must never let old and new code write the same directory.** The old build ignores every lock; measured with one old and one hardened process writing at once, 38 of 135 acknowledged
   writes were lost. "Deploy in a quiet period" is not enough. `docs/datastore-first-deployment.md` moves the data to a new directory and fences the old one so a surviving old process fails closed; it is rehearsed
   with a real old build left running (`checks/run-cutover-drill.ps1`). It needs the host to allow a different DATA_DIR for the new deployment; if it cannot, deployment is blocked.
8. **Backups are not a fix and are still needed.** This prevents overlapping writes; it does not replace backups (the lost-update and corruption cases it prevents are exactly what a restore would be needed for).

## New behaviour operators will notice

- In **production**, if `DATA_DIR` is wrong or `db.json` is missing, the app now fails loudly (`DATASTORE_NOT_INITIALISED` or `DATASTORE_MISSING`) instead of starting with an empty datastore.
  For a brand-new install set `SANDC_ALLOW_NEW_DATASTORE=1` once, then remove it. Check `DATA_DIR` before deploying.
- Beside `db.json` there is now a one-line `.datastore-initialised` marker, and, transiently, `db.json.lock`. A crash can leave a lock file (taken over automatically if its process is dead) or an
  orphan `.db.json.tmp-*` (removed on the next successful write if its process is dead). Neither is ever read as data.
- Operator scripts abort with `CONFLICT` if the datastore changed while they ran, instead of overwriting it. Re-run them. They also wait for the lock.

## Rollback

Redeploy the previous build. The file format is unchanged, so there is no data step. The marker, lock and temp files are ignored by the old code. The old normaliser drops unknown top-level keys on its next
save, but this change adds none. Take the dated backup first, as always.
