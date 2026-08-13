# Background scheduler

This app has no in-process scheduler — there is deliberately no
`setInterval`/`setTimeout` anywhere creating a "background job". A typical
Next.js deployment (Vercel, most serverless/edge hosts, and even a plain
`next start` behind a process manager that can restart or scale instances)
doesn't guarantee a single long-lived process exists to host a timer
reliably: it can run on multiple instances at once (duplicating jobs), or
none (a cold start, an idle scale-to-zero period) at the moment a timer
would have fired. Pretending otherwise would be the same kind of dishonesty
this app avoids elsewhere (see `lib/billing.ts`, `lib/ai.ts`).

Instead, the actual job logic lives in plain, directly-callable, testable
functions (`lib/jobs/*.ts`), and something *external* to the running app
process decides when to call them.

## Architecture

- `lib/jobs/<job-name>.ts` — one file per job. Each exports a
  `JobDefinition { name, description, run() }`. `run()` is a plain async
  function returning a human-readable summary string — no scheduler
  concepts leak into the job itself, so each one is unit-testable in
  isolation with a mocked `lib/db.ts`.
- `lib/jobs/registry.ts` — `ALL_JOBS`, the ordered list a full run executes.
- `lib/jobs/runner.ts` — `runJob()` / `runAllJobs()`. Times each job, never
  lets one job's failure stop the others, and persists a `JobRunRecord` via
  `lib/db.ts` (`createJobRun`/`findRecentJobRuns`) so what ran and what
  happened is inspectable later — by staff (Staff Operations page) or a
  developer, without needing external logging infrastructure.
- `app/api/cron/run/route.ts` — the one HTTP entry point. Accepts either:
  - `Authorization: Bearer ${CRON_SECRET}` (an external scheduler), or
  - a staff session cookie (the "Run now" button on `/staff/operations`).

## Jobs currently defined

| Job | What it does | Why it can't just rely on page loads |
|---|---|---|
| `expire-stale-checkouts` | Flips `pending` subscriptions past the retry window (`PENDING_CHECKOUT_STALE_AFTER_MS`, 30 min) to `inactive`. | The member-facing UI already lets a member retry once stale, but the stored `status` never actually changes unless someone loads the membership page — this makes the underlying state honestly reflect reality even if no one ever does. |
| `notify-lapsed-memberships` | Messages a member the first time their `active` subscription's period is found to have lapsed; marks it so it isn't re-sent. | Nothing currently tells a member their access lapsed except them noticing a badge change next time they happen to open the app. |
| `cleanup-past-waitlists` | Deletes waitlist entries for classes that have already started. | `promoteFromWaitlist` only runs reactively when a spot opens — if nobody ever cancels, a waitlisted member is stuck in a now-meaningless queue forever. |
| `purge-expired-reset-tokens` | Deletes expired password reset tokens. | Pure storage hygiene; `consumeResetToken` already rejects expired tokens lazily, so this changes no behavior, just keeps `data/db.json` from growing dead rows forever. |

Add a new job by creating one file in `lib/jobs/` and adding it to
`ALL_JOBS` in `lib/jobs/registry.ts` — nothing else needs to change.

## What's needed to actually schedule this in production

A `vercel.json` is already checked in, configured to call
`GET /api/cron/run` every 15 minutes:

```json
{ "crons": [{ "path": "/api/cron/run", "schedule": "*/15 * * * *" }] }
```

1. **Set `CRON_SECRET`** as an environment variable in your deployment
   (and in Vercel's project settings if deploying there). Generate with
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. **On Vercel**: cron jobs defined in `vercel.json` are picked up
   automatically on deploy — no extra setup beyond the env var. Vercel
   sends the `Authorization: Bearer ${CRON_SECRET}` header automatically.
   ⚠️ **Hobby plan limits cron jobs to once per day**, regardless of the
   schedule expression — the 15-minute schedule above requires a Pro plan
   to run as configured. On Hobby, expect once-daily housekeeping instead;
   the reactive paths (retry-on-stale-checkout in the UI,
   promotion-on-cancellation) still cover the time-sensitive parts in the
   meantime.
3. **Not on Vercel?** `.github/workflows/housekeeping.yml` already does this
   — it runs every 15 minutes and calls
   `curl -X POST $PROD_URL/api/cron/run -H "Authorization: Bearer $CRON_SECRET"`.
   It needs two repository secrets set once, in GitHub under Settings >
   Secrets and variables > Actions:
   - `PROD_URL` — the production origin, e.g. `https://your-domain.com`
     (no trailing slash).
   - `CRON_SECRET` — must match the `CRON_SECRET` env var set on the
     Hostinger deployment itself (step 1 above); the workflow doesn't set
     that half, only reads it.
   Any other scheduler works too (system cron, a different host's native
   scheduled-task feature) if GitHub Actions isn't preferred.
4. **Manual testing locally** — with the dev server running:
   ```bash
   curl -X POST http://localhost:3000/api/cron/run \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
   or, simpler in development (no `CRON_SECRET` needed), sign in as staff
   and click "Run housekeeping now" on `/staff/operations`.

## Observability

Every run — cron-triggered or manual — is recorded per job (name, status,
summary, duration, timestamps, and how it was triggered) and surfaced on
`/staff/operations`. There's no separate logging system to check; the
history lives in `data/db.json` like everything else in this prototype, via
`findRecentJobRuns()`.
