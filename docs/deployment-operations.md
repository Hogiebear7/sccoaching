# Deployment and operations guide

Ongoing operational reference for running this app in production, once
`docs/launch-checklist.md` and `docs/launch-day-runbook.md` are done. This
document doesn't repeat their one-time pre-launch content — see them for
credential rotation, Stripe production setup, and the initial go-live walk.
This is for every deployment after that.

## 1. Build and start commands

```
npm ci
next build --webpack
next start
```

`--webpack` is **not optional**: the production build host cannot run
Turbopack or native SWC (older glibc), so `next build` without `--webpack`
fails there even though it works on a developer machine. Never drop the flag,
and never let a dependency bump silently change the default build script back
to plain `next build`.

Run as **one long-lived Node process** behind a process manager — not
serverless, not multiple instances. See §3 below for why.

## 2. Required environment variables (names only)

See `docs/launch-checklist.md` §4 for the full list with explanations, and
`.env.local.example` for every variable name this app reads (no values are
recorded anywhere in the repository). At minimum, production needs:

- `SESSION_SECRET` — signs every session token; rotating it invalidates all
  logged-in sessions.
- `DATA_DIR` — where `db.json` and related files live; must point outside the
  deploy-managed release tree so it survives redeploys (see §5).
- `CRON_SECRET` — see §6.
- `APP_URL` — used to build absolute links in emails and redirects; if unset,
  links point at `localhost`.
- The Stripe, Revolut, Supabase, Resend, Anthropic, VAPID and Google Play
  variables documented in `.env.local.example` and `docs/launch-checklist.md`.

**`TRUSTED_PROXY_HOPS`** (new, added alongside this session's rate-limiting
work — see `lib/client-ip.ts`): governs whether `X-Forwarded-For` is trusted
for IP-based rate limiting on the public signup and contact endpoints.

- **Default: unset (0).** No forwarded header is trusted at all; every
  request behind an unconfigured proxy shares one site-wide bucket with a
  higher cap. This is deliberately conservative and safe to leave unset.
- **Do not set it** until you've confirmed, on the actual deployed host, how
  many trusted proxies sit in front of the app and append to
  `X-Forwarded-For` (Hostinger's own load balancer or CDN layer, if any).
  Setting it too low keys everyone by one proxy's address (over-broad shared
  buckets); setting it too high trusts a client-supplied entry (a real
  bypass). **This verification requires owner access to Hostinger's network
  configuration — it was not performed as part of this session.**

## 3. Datastore and process model

`data/db.json` (or `DATA_DIR`) is a single JSON file, read and written
synchronously, with no locking. This is only correct for **one persistent
Node process**. Concurrent instances (serverless, horizontal scaling, a
second `next start` pointed at the same file) will corrupt it. See the
README's Deployment section for the full rationale.

This constraint also governs the rate limiter (§4) and the job runner
(§6): both assume one process.

## 4. Rate limiting — process-local, not distributed

`lib/rate-limit.ts` is an in-memory sliding-window limiter. It is honest
about what it is, and what it is not:

- **Process-local.** State lives in the one Node process's memory. It is
  **not** shared across instances, and it resets on every restart —
  including every redeploy. Do not read a quiet rate-limit bucket as
  evidence of anything beyond "since the last restart."
- **Bounded.** At most 10,000 distinct keys are tracked at once, with
  least-recently-used eviction and periodic sweeping, so an attacker
  presenting many distinct keys cannot grow memory without limit. See the
  comments in `lib/rate-limit.ts` for the exact trade-off this accepts.
- **Client identification** for the public signup and contact endpoints goes
  through `lib/client-ip.ts` under the `TRUSTED_PROXY_HOPS` policy in §2.
  Authenticated routes (invites, AI usage, etc.) key by the session's own
  user/gym id instead, never by IP.

If this app is ever scaled to more than one process, this limiter must be
replaced with a shared store (Redis or similar) — that is a deliberate
architecture change, not a configuration flag, and is out of scope until the
single-process constraint in §3 itself is revisited.

## 5. Backup and recovery

- `DATA_DIR` must point at a persisted volume that survives redeploys and
  restarts — a deploy-managed release folder is not durable storage.
- Take a copy of `db.json` before any manual data operation (a promotion
  script, a cleanup script, a permission change). This session's own
  precedent: `cp -p db.json ~/backups/db.json.pre-<change>-<timestamp>`, then
  `chmod 600` on the backup (it contains personal data).
- Prefer a script's own `--confirm`-gated write path (with its own automatic
  backup) over a manual edit whenever one exists — see `scripts/*.mjs`, all
  of which follow this pattern: dry-run by default, explicit target,
  backup-then-write.
- **Recovery** from a bad manual data change is: restore the most recent
  `db.json` backup, then re-apply only the changes actually intended, one at
  a time, re-verifying after each.
- **This session did not design a scheduled/automated backup process.**
  Confirm whether Hostinger's own hosting plan includes file backups; if not,
  that is a genuine gap the owner should close.

## 6. Cron / background jobs

See `docs/scheduler.md` for the full job-runner architecture. Operationally:

- The scheduled trigger is `.github/workflows/housekeeping.yml`, calling
  `POST /api/cron/run` with `Authorization: Bearer <CRON_SECRET>` every 15
  minutes. Requires the `PROD_URL` and `CRON_SECRET` GitHub repository
  secrets to be set (Settings → Secrets and variables → Actions on GitHub —
  distinct from any Hostinger setting).
- The secret comparison is constant-time (`timingSafeEqual`), and a
  platform-operator staff session is an equally-valid trigger (the
  "Run housekeeping now" button on `/staff/operations`).
- **No request-count rate limit is applied to this route**, deliberately: the
  GitHub workflow's own retry behavior (`curl --retry 3 --retry-all-errors`)
  against a 15-minute schedule, plus manual/operator-triggered runs, made a
  blunt count-based limit a real risk of blocking legitimate use. If this is
  revisited, the safe design is to throttle only *failed-authentication*
  attempts, never successful ones — this was scoped but not implemented in
  this session; see §9.

## 7. Deployment verification steps (Hostinger)

Do this after every deploy, before considering it live:

1. **hPanel → Deployments.** Find the entry created from the merge you expect
   to be live.
2. Confirm its **status is Completed** and it is **marked Current** (the
   active release Hostinger is actually serving).
3. **Identify the deployed commit.** Hostinger's deployment entry records the
   source commit hash — compare it against `git log --oneline -1` on
   `redesign/index-html-blueprint` (or the specific merge commit you expect).
   A deployment being "Current" and a commit hash matching what you expect
   are two separate facts; check both.
4. **Check the build log** for errors. The one known recurring risk, before
   this session's font work, was a transient failure fetching Google Fonts at
   build time — self-hosting the fonts (`app/fonts/`, `next/font/local`)
   removed that specific network dependency, but check the log anyway.
5. **Check runtime/application logs** (however Hostinger exposes them) for
   startup errors after the new process comes up.
6. Only once 1–5 all pass should this deployment be described as verified —
   a completed build alone is not evidence the app is serving correctly.

## 8. Smoke-test checklist (post-deployment)

Run with an approved staff/test account and synthetic data only — never a
real customer or recipient unless the specific flow requires it and you
intend to complete it for real.

- [ ] Non-archived login succeeds.
- [ ] An archived account is rejected at login.
- [ ] A cross-tenant request (e.g. a staff member viewing another gym's
      member id) returns the expected not-found/denied response.
- [ ] A same-tenant authorized action (view a member, edit a class) succeeds.
- [ ] Public gym signup returns a normal validation error for a malformed
      request, and — separately, deliberately, only if you intend to create a
      real gym — succeeds for a valid one. (There is no tool to remove a gym
      once created; see `docs/tenant-boundary-audit-2026-09.md`.)
- [ ] One staff invite to a test recipient succeeds, and is revoked
      afterward if it isn't a real invitation.
- [ ] `/staff/operations` "Run housekeeping now" succeeds for a
      platform-operator session.
- [ ] The next scheduled GitHub Actions housekeeping run (`.github/workflows/
      housekeeping.yml`) shows green.
- [ ] No unexpected `429` on an ordinary request (see §4 — a wrongly-tight
      rate limit would show up here first).

## 9. Rollback procedure

This app has no built-in rollback tooling; rollback means **redeploying the
previous known-good build**:

1. In hPanel → Deployments, locate the previous deployment that was
   confirmed Current and healthy.
2. Use Hostinger's own "redeploy" or "make current" action for that entry (or
   redeploy from that commit, per whatever hPanel's UI calls it — this
   session has not needed to exercise this path, so confirm the exact button
   the first time).
3. Re-run the verification steps in §7 against the rolled-back deployment.
4. If the bad deploy also wrote data (a migration, a manual script run),
   rolling back the *code* does not undo the *data* change — see §5 for data
   recovery, which is separate from a code rollback.

## 10. Which steps require the owner, and which must never be automated

**Owner-only, every time:**
- Confirming a deployment in hPanel (§7) — no automated agent in this
  engagement has had Hostinger access.
- Running any smoke test against the live app (§8) — no automated agent has
  had a route to the live application or real test credentials.
- Setting or changing `TRUSTED_PROXY_HOPS` (§2) — requires knowledge of
  Hostinger's actual network topology.
- Running `npm run promote:platform-operator -- --confirm` against
  production — see `docs/tenant-boundary-audit-2026-09.md` and the
  promotion runbook precedent in this session's history: dry run first,
  explicit single target, independent backup, then confirm.
- Any Stripe/Revolut/merchant-of-record/tax decision — explicitly out of
  scope for automated implementation; see
  `docs/tenant-boundary-audit-2026-09.md` §12.6.
- Any decision to restrict currently-shared platform-wide data (the exercise
  library, class categories, workout-template global fallback behavior, food
  catalog moderation) to a single tenant or to the platform operator only —
  these are product/policy calls, not bugs; see §12.6 of the same document.

**Must never be automated without a separate, explicit approval each time:**
- Deploying, redeploying, or rolling back.
- Changing production environment variables or secrets.
- Any write to the production datastore outside an approved,
  dry-run-first script.
- Merging a pull request.

## 11. Continuous integration

`.github/workflows/pr-checks.yml` runs on every pull request targeting
`redesign/index-html-blueprint`: TypeScript, the full test suite,
`git diff --check`, ESLint scoped to the PR's changed files (see that
workflow's own comments for why it's scoped rather than repo-wide), and a
production build using fixed, non-secret placeholder environment values. It
contacts no external service and references no repository secret, so it is
safe to run on a pull request from a fork.

**Recommended branch protection** (not enabled by this session — a repository
settings change needs explicit owner approval):
- Require the `pr-checks.yml` jobs to pass before merging into
  `redesign/index-html-blueprint`.
- Require at least one review before merge.
- Do not allow force-pushes to `redesign/index-html-blueprint`.

## 12. Visual regression testing

`npm run test:visual` (Playwright) is not part of CI (see §11) and was not
run in every session of this engagement — it requires a Chromium browser
binary that isn't always available in a given execution environment, and
installing one requires network access to `cdn.playwright.dev`, which is not
guaranteed. When it can run, treat a Chromium-version mismatch or install
failure as a reason to skip it and report why, not a reason to change
`playwright.config.ts` to force a mismatched browser.
