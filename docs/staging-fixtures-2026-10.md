# Staging fixtures: safe two-gym test data (2026-10)

`scripts/seed-staging-fixtures.mjs` (`npm run seed:staging-fixtures`) builds a small, clearly fake, **two-gym** datastore for **isolated staging
and test validation only**. It exists because the existing demo seed (`scripts/seed.js`) is unsuitable for a reachable server: its accounts share
one documented password, and it creates no second gym, so tenant isolation cannot be checked from seeded data. `scripts/seed.js` and `npm run seed`
are unchanged.

Do not run this against production, a real member datastore, or the repository's `data/` folder. It refuses to.

## What it creates
- **Two gyms.** The primary gym (users with no `gymId`, slug `sc-performance-coaching`, as `lib/primary-gym.ts`) and a second gym (`fixture-second-gym`).
  Each has `Fixture ...` names, a `@example.test` contact address and a "safe to delete" description.
- **Six users, all `fixture-...@example.test`:** primary gym: an `admin_manager`, a `coach`, and two members (one with a plan, one without);
  second gym: an `admin_manager` (the gym's owner) and one member with a plan.
- **For device checks:** a no-charge manual plan per gym (catalog entry plus an active manual membership with no provider), classes (three in the primary
  gym, one in the second), bookings, and for one primary member a programme, three recovery check-ins and a coach conversation. That member's profile
  starts on the first-run walkthrough.
- **Not created:** any payment, purchase, revenue, provider, webhook, push-token or IAP record. Billing options have an amount of 0 and no provider
  price reference, so no price appears in the app.

## Credentials: no password is ever in the repository, the output or the datastore
- Every account gets a **fresh random 24-character password** on every run (it meets the app's strength rules).
- Passwords are written **only** to the file you give with `--credentials-out`. That file is created exclusively (an existing file is never overwritten),
  with owner-only permissions on POSIX, and it must be **outside the repository**. On Windows POSIX permissions do not apply, so keep it in a folder only
  the operator can read.
- The datastore holds only the scrypt hash, in the same `salt:hash` format as `lib/password.ts`. Standard output lists accounts (email, role, gym) and the
  credentials file path, never a password.
- **How an authorized operator gets them:** the person who ran the generator reads the credentials file, hands it to the authorized tester through an
  approved private channel (not chat, email to a shared inbox, a ticket or the repository), and **deletes the file** once it has been received.
  Re-running with `--reset` issues new passwords and invalidates the old ones.

## Required environment, by name
- `GYM_DB_PATH`: **required.** The explicit staging datastore file. There is no `DATA_DIR`, config or default fallback, so a forgotten variable can never
  choose a target.
- For the app that will serve it: `DATA_DIR` set to the folder holding that file (it reads `<DATA_DIR>/db.json`), and the staging variables in the
  staging plan. This script reads only `GYM_DB_PATH`.

## Usage
```
# 1. Dry run: reports the target and accounts, writes nothing (no datastore, no credentials file).
GYM_DB_PATH=/srv/sandc-staging/data/db.json node scripts/seed-staging-fixtures.mjs --dry-run

# 2. Generate. Credentials go to a new file outside the repository.
GYM_DB_PATH=/srv/sandc-staging/data/db.json \
  node scripts/seed-staging-fixtures.mjs --credentials-out /secure/operator-only/fixture-creds.json
```
Stop the app before writing, because the datastore is a single JSON file written by one process. Check that the printed `Fixture target` is the same file
the app uses (`<DATA_DIR>/db.json`).

## Refusals (decided before anything is written; exit code 2)
- `GYM_DB_PATH` missing or blank.
- A target that is not a `.json` file, or is a directory.
- A target inside the repository `data/` folder, checked by path first and again by real location (so a symlink cannot hide it).
- `--credentials-out` missing (except with `--dry-run`), inside the repository, equal to the datastore, already existing, or in a folder that does not exist.
- An existing datastore without `--reset`.
- `--reset` on any datastore that is not made **entirely** of `@example.test` users (or that cannot be read). Nothing is changed.

## Re-runs
A second run on the same target **refuses** with a message. `--reset` replaces a fixture datastore, keeps a `db.json.bak-<timestamp>` copy next to it,
and issues new passwords. It cannot be used on anything that is not a fixture datastore.

## Cleanup and wipe
1. Stop the staging app.
2. Delete the staging datastore file, any `db.json.bak-*` copies, and the credentials file. They hold only fake data and fixture hashes.
3. To start again, run the generator against a new path, or with `--reset` before deleting.
4. Teardown of the host itself (endpoint, DNS, secrets) is in the staging plan and is a separate, separately approved step.

## What this does not enable
No provider is configured or contacted. IAP stays off (`GOOGLE_PLAY_IAP_ENABLED` unset), payments and webhooks have no secrets, push and the scheduler
are not started, and nothing here touches production or a real datastore. The generator writes one datastore file and one credentials file, and
creates no other file.

## Tests
`__tests__/scripts/seed-staging-fixtures.test.ts` runs the real script in temporary directories only. It covers every refusal, dry run writing nothing,
output with no password, owner-only file permissions (on POSIX), unique strong passwords that match the stored hashes and differ on every run, no
fixed password anywhere, `@example.test`-only data, no payment or provider records, the two-gym data model, re-run and `--reset` behaviour, and, against
a copy of the generated datastore loaded into the real app code, that every account can log in and that staff reach their own gym's members but get
"Member not found." for the other gym's.
