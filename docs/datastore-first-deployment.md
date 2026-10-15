# First deployment of the hardened datastore: a cutover, not an overlap

**Status: designed and rehearsed locally. Not approved, not run anywhere near production. Nothing in this file may be executed on the production host without the owner naming a window and approving this procedure.**

## Why "deploy in a quiet period" is not enough

The previous build rewrites `db.json` with a plain `writeFileSync` and ignores every lock. The hardened build only protects data from writers that obey its lock. If an old process and a hardened process ever write the same directory, writes are lost: measured with one of each writing at once, 38 of 135 acknowledged workouts were missing, 35 recovery and 36 food entries were missing, and a shared counter ended at 10,500 of 13,200. Shrinking the overlap shrinks the loss; it does not remove it, and the host cannot promise there is no overlap.

So the procedure below never lets old and new code write the same directory:

1. The data **moves** to a NEW directory that only the hardened build uses.
2. The OLD directory is **fenced**: `db.json` is renamed to `db.json.retired-<UTC stamp>` and a **directory** named `db.json` is put in its place. An old process that is still alive finds "a file" (its existence check passes), then `readFileSync` and `writeFileSync` on a directory fail with `EISDIR`. Its requests fail with an error; nothing is written; no empty datastore is ever created. (If `db.json` were simply missing, the old code would silently start an EMPTY datastore and write it.)
3. The retired file is the exact state at the instant of the fence. It is copied, byte for byte and hash-verified, into the new directory. It is **never restored over newer data**.

This does not depend on proving the old processes have exited. It makes a surviving one harmless and visible. Exit is checked as far as the host allows, and is **not claimed** where it cannot be proven.

## Which old writers this covers

| Old writer | What happens |
|---|---|
| HTTP requests to the old app (members, staff, webhooks) | Before the fence: included in the retired file (a write in flight at the fence finishes into the retired file and the settle check waits for it). After the fence: fail closed with HTTP 500, not acknowledged, nothing written. |
| Background jobs | There is no timer in the app. Jobs run only when `/api/cron/run` is called (the scheduler workflow, or "Run now"). They stop when the scheduler is paused (step 1) and, if one is mid-run in the old app, it is an HTTP request: covered by the row above. A maintenance page does **not** stop them; the fence and the scheduler pause do. In the hardened build a run lease stops two runs overlapping. |
| Operator scripts pointed at the old directory | Fail closed (the datastore is a directory, not a file). Scripts must use the NEW directory from the cutover on; they then use the lock and compare-and-swap. |
| A redeploy of the old build with `DATA_DIR` still pointing at the OLD directory | Fails closed (same as above). |
| A redeploy of the OLD build with `DATA_DIR` set to the NEW directory | **Not prevented.** It would write unlocked into the new data. It is **detected**: the hardened build logs `possible foreign write` when it finds db.json rewritten in place. Operational rule: never run an old build against the new directory; turn off any automatic redeploy of the old branch. |

## Preconditions: ALL must be answered YES, in writing, before a window is chosen

| # | Precondition | Who answers | If NO |
|---|---|---|---|
| P1 | The host allows `DATA_DIR` to be set to a different directory for the new deployment, on the same account, and the value takes effect when the app restarts | Hostinger / owner | **Blocked** (see below) |
| P2 | The app can be **stopped** from the hosting panel and shown stopped, and the number of app processes now and after the change is stated by the host | Hostinger / owner | Blocked for a proven-exit claim; the fence still contains a surviving process, so deployment is allowed only if the owner accepts "contained, not proven exited" in writing |
| P3 | `node scripts/check-datastore-filesystem.mjs --dir <parent of the new directory>` prints PASS for every check **on the production filesystem** | Whoever has a shell on the host (or host support) | **Blocked**: exclusive create, atomic rename and hard links are what the lock needs |
| P4 | The cutover tool can be run on the host (needs Node and a copy of `scripts/datastore-cutover.mjs` and `lib/datastore/core.js`) | Owner / host | Blocked, or the degraded manual path in "No shell" below |
| P5 | A dated, verified backup exists, per the standing rules (checksum, size, timestamp recorded; prior backups never overwritten) | Owner | Blocked |
| P6 | The scheduler is paused (the GitHub Actions housekeeping workflow disabled), no operator script is running or scheduled, and everyone with shell access has been told | Owner | Blocked |
| P7 | The window is named by the owner and members are told the app will be unavailable for a few minutes | Owner | Blocked |
| P8 | The rehearsal (`checks/run-cutover-drill.ps1`) passed on the exact commit being deployed | Engineering | Blocked |
| P9 | The owner has approved THIS procedure for THAT window | Owner | Blocked |

## Procedure (every command prints counts and hashes only, never data)

`OLD` is the current `DATA_DIR`. `NEW` is a sibling directory, for example `OLD` followed by `-hardened`. Stop at the first step that does not give the stated result.

1. **Freeze.** Disable the scheduler workflow. Check `/staff/operations`: the last housekeeping run has finished and no `job-run-lease` file exists beside the datastore. Tell shell users not to run scripts.
2. **Backup**, exactly as in `docs/deployment-operations.md`. Record checksum, size, timestamp.
3. **Preflight (read-only):** `node scripts/datastore-cutover.mjs preflight --from OLD --to NEW`. Expected: every line PASS.
4. **Stop the old app** in the hosting panel. Record the panel's state, and where a shell exists a process listing (`pgrep -u "$USER" -af node`). This is evidence, not the guard.
5. **Fence:** `node scripts/datastore-cutover.mjs fence --dir OLD --confirm-app-stopped`. Expected: `FENCED`, then `SETTLED retired file stable`. If it exits 3, a process is still writing into the retired file: **stop**, find and stop it with the host's help, then `fence-settle --retired <file>`.
6. **Adopt:** `node scripts/datastore-cutover.mjs adopt --retired OLD/db.json.retired-... --to NEW`. Expected: `ADOPTED ... identical to the retired file`.
7. **Verify before starting:** `node scripts/datastore-cutover.mjs verify --retired OLD/db.json.retired-... --to NEW --fenced-dir OLD`. Expected: all PASS.
8. **Deploy the hardened build** with `DATA_DIR=NEW`. Do **not** set `SANDC_ALLOW_NEW_DATASTORE`. (The build refuses to start with an empty datastore in production; a wrong path stops it rather than creating one.)
9. **Check:** `/login` answers 200; the app log has no `DATASTORE_*` error and no `possible foreign write`; `verify` again (no collection has fewer records than the retired file).
10. **Re-enable the scheduler.** Watch the first run: the lease file appears and is removed, and every job outcome is recorded.

**Monitoring afterwards (at one hour, one day, one week):** `verify` (the retired file's hash never changes; the fence directory holds only its README and FENCE record); the log has no `possible foreign write`; the count of `DATASTORE_BUSY` is not growing. A change in the retired file means something wrote to the old datastore after the fence: stop and decide with the owner what to do with that data.

## What this does not prove, stated plainly

- It does not prove the old processes have exited. It shows the host's stopped state and, where a shell exists, a process list; the fence is what makes a missed process harmless.
- A write the old app acknowledged to a member **before** the fence is in the moved data (settle check). A write attempted after it is refused with an error, so the member knows it did not save.
- Zero loss is not promised. Filesystem behaviour on the host is unverified until P3 is run there.
- The old and new directories are separate datastores from the cutover on. Anything that keeps using the old path (a bookmark to a script, a cron entry) must be found and changed.

## No shell on the host

If the host offers only a file manager and a Node app panel (no terminal), the tool cannot run there. The weaker manual path uses the file manager: stop the app; rename `db.json` to `db.json.retired-<stamp>`; create a folder named `db.json`; copy the retired file into the new directory as `db.json`; compare file sizes and modified times of the retired and copied file; set `DATA_DIR`; deploy. This has **no hash check and no settle check** (a write still in flight at the rename could be missed); the marker file is created by the first write. It should be used only if the owner accepts those gaps in writing; the better answer is to get one shell session, for example from host support.

## Rollback: preserve the current datastore, never restore a stale file

- **Prefer fix-forward.** A defect in the hardened code is fixed and redeployed with the same `DATA_DIR`; the file format did not change and no data step is needed. An earlier hardened build can also be redeployed on the same directory.
- **Going back to the OLD (unlocked) build re-creates the original risk** and is the owner's decision at the time. If it is made: stop the hardened app and confirm it exited; `fence --dir NEW --confirm-app-stopped`; `adopt --retired NEW/db.json.retired-... --to THIRD`; set `DATA_DIR=THIRD`; deploy the old build. The **current** data (including everything written since the cutover) moves to `THIRD`; the hardened directory is fenced so the hardened build cannot write beside the old one; the original `OLD` directory stays fenced. Rehearsed in the drill.
- **Never** copy `OLD/db.json.retired-...` or a backup over the current datastore as routine rollback: that deletes every member action since. If corruption of the current file is ever proven, first copy the current file to a new dated name, then decide with the owner; restoring older data is a data-loss decision, made explicitly.
- Nothing in any rollback step deletes a file. Each cutover leaves a new retired file and a fence behind.

## If the host cannot give what the procedure needs: deployment is BLOCKED

Blocked when P1 (no separate `DATA_DIR`), P3 (filesystem checks fail) or P4 with no acceptable alternative cannot be satisfied, or when the host cannot show the app stopped and the owner does not accept "contained, not proven exited".

The safest alternative with resources that already exist is to **stay on the current build and shrink the exposure**, without calling it a fix: no operator scripts except one at a time after a verified backup; deploys only in a quiet window and only after stopping the app first; daily verified backups; ask the host in writing to run exactly one instance; do not launch publicly on a datastore that two processes can write. Moving the production service onto the owner's own always-on machine would give one process, but it is a hosting and DNS change that is not authorised and trades this risk for availability risk; it is listed only so it is not forgotten.
