# Launch checklist

Status as of the launch-readiness pass (July 2026). Items marked ☐ are
manual dashboard/deployment actions only the operator can perform; nothing
in the codebase blocks them.

## 1. Credentials — rotate before anything ships

| Credential | Why it must rotate | How |
| --- | --- | --- |
| ☐ `ANTHROPIC_API_KEY` | The development key appeared in terminal output and (briefly) in a filename during development. | Anthropic Console → API keys → create new, delete old. |
| ☐ `STRIPE_SECRET_KEY` | Current value is a **test-mode** key that was shared in chat during setup. Production needs a live key; the test key should be rolled too. | Stripe dashboard → Developers → API keys. Live and test keys come from different dashboard modes — never reuse test keys in production. |
| ☐ `STRIPE_WEBHOOK_SECRET` | Current value is the local CLI listener secret — it is meaningless in production. | Created automatically when you add the production webhook endpoint (step 2). |
| ☐ `SESSION_SECRET` | Dev value has been on a dev machine; production should have its own. Rotating invalidates all existing sessions (fine at launch). | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

## 2. Stripe production configuration

- ☐ Add a webhook endpoint in the Stripe dashboard (live mode) pointing at
  `https://<domain>/api/stripe/webhook`, subscribed to exactly these events:
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired`,
  `charge.refunded`, `invoice.paid`, `invoice.payment_failed`,
  `customer.subscription.deleted`.
  (`invoice.payment_succeeded` is also handled if delivered, but does not
  need separate registration.)
- ☐ Set `APP_BASE_URL=https://<domain>` — Stripe checkout success/cancel
  redirects are built from it. If unset, members return to localhost after
  paying.
- Signature verification, event-id dedupe, out-of-order guards and
  entitlement idempotency are code-side and already verified (see §5).

## 3. Cron / background jobs

- ☐ Set `CRON_SECRET` (generate like `SESSION_SECRET`).
- ☐ Configure the external scheduler to call
  `POST https://<domain>/api/cron/run` with
  `Authorization: Bearer <CRON_SECRET>` — hourly is sufficient for every
  current job (checkout expiry, lapse + pass-expiry notices, waitlist
  offers, class reminders, cleanup). See `docs/scheduler.md`.
- Verified code-side: with no/incorrect secret the endpoint returns 401;
  staff sessions can always trigger a manual run from Staff → Operations.

## 4. Environment variables for production

Required: `SESSION_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`APP_BASE_URL`, `APP_URL` (email links), `CRON_SECRET`.

Feature-gated (app degrades honestly without them): `ANTHROPIC_API_KEY`
(AI coach), `RESEND_API_KEY` + `EMAIL_FROM` (real email — the resend.dev
sandbox sender is rejected in production; use a verified domain sender),
`VAPID_*` + `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (web push),
`CANCELLATION_CUTOFF_HOURS` (defaults to 12).

Do **not** set any `REVOLUT_*` variables — Stripe is the active provider;
the Revolut path exists only as dormant fallback code.

`.env.local.example` documents every variable, including generation
commands.

## 5. Manual sandbox walkthrough — PASSED

All nine critical flows executed against the running app in one scripted,
self-cleaning run (webhook calls genuinely HMAC-signed so the full
signature → dedupe → handler pipeline was exercised):

1. **Signup** — account + profile created, chosen palette stored (201).
2. **Login** — session cookie issued and verified.
3. **Membership renewal** — signed `invoice.paid` rolled a past_due
   subscription to active with the real invoice period end and usage reset.
4. **Class booking** — booked against plan allowance.
5. **Pass purchase** — real Stripe test checkout session created; signed
   `checkout.session.completed` credited the ledger exactly once.
6. **Pass expiry warning** — cron run produced one deduped notification for
   a pool expiring within a week.
7. **Staff class delete** — booking cancelled, pass restored to the correct
   pool, member notified.
8. **Member archive/restore** — archived login blocked with 403, restore
   re-enabled sign-in.
9. **Plan archive/delete** — archive succeeded; delete of a referenced plan
   refused with 409; delete of an unreferenced plan succeeded.

## 6. Deployment constraint worth knowing

The data layer is a single JSON file (`data/db.json`) with synchronous
read/write — correct for one persistent server instance, not for
serverless/multi-instance deployments (concurrent instances would clobber
each other's writes). Deploy as a single long-lived Node process (e.g.
`next start` behind a process manager) with `data/` on a persisted volume
that is backed up. A real database is the first infrastructure upgrade
once launch traffic justifies it.

## 7. Pre-launch hygiene

- `.env*` and `data/` are gitignored — verified; no secret has ever been
  committed. History contains no key material (keys were only ever in
  `.env.local` and terminal output — hence the rotations in §1).
- Demo accounts (`alex@`, `coach@`, `paytest@demo.local`) and seed data
  should be removed or repointed before real members sign up
  (`scripts` seeding and the demo reset flow are dev tools).
