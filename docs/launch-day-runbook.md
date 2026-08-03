# Launch runbook

One-page operator checklist. Follow in order. No code changes required.
Fill in **Owner** and **Evidence of completion** as each item is done.

## 1. Pre-launch checklist

| ✓ | Task | Owner | Evidence of completion |
|---|---|---|---|
| ☐ | Rotate `SESSION_SECRET`, `STRIPE_SECRET_KEY` (live-mode, not test), `ANTHROPIC_API_KEY` (if AI coach is enabled) | | |
| ☐ | Confirm deployment runs as one persistent Node process (`next build && next start` behind a process manager) — not default serverless | | |
| ☐ | Confirm `data/` is on storage that survives redeploys/restarts, with scheduled backups | | |
| ☐ | Set required env vars: `SESSION_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_BASE_URL`, `APP_URL`, `CRON_SECRET` | | |
| ☐ | Set feature env vars as needed: `RESEND_API_KEY` + `EMAIL_FROM` (verified sending domain, not the sandbox address), `ANTHROPIC_API_KEY`, `VAPID_*` keys | | |
| ☐ | Confirm no `REVOLUT_*` env vars are set | | |
| ☐ | Deploy to production | | |
| ☐ | Register live Stripe webhook: `https://<domain>/api/stripe/webhook`, subscribed to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted` | | |
| ☐ | Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`, redeploy/restart | | |
| ☐ | Configure external scheduler: `POST /api/cron/run` hourly, header `Authorization: Bearer <CRON_SECRET>` | | |
| ☐ | Clean up demo/seed accounts (section 6) | | |
| ☐ | Confirm or replace placeholder content (section 5) | | |
| ☐ | Run the launch-day smoke test (section 2) | | |

## 2. Launch-day smoke test

| ✓ | Task | Owner | Evidence of completion |
|---|---|---|---|
| ☐ | Load homepage — no console errors | | |
| ☐ | Load `/privacy` and `/terms` — confirm footer and contact-form links work | | |
| ☐ | Sign up a new test account (real email), log in | | |
| ☐ | Request password reset — confirm real email arrives, reset via the link, log in with the new password | | |
| ☐ | Book a class, then cancel it — confirm credit is restored | | |
| ☐ | Make a controlled live Stripe payment (smallest pass/membership); confirm the webhook returns 200; verify expected app state (access granted); refund/cancel if appropriate | | |
| ☐ | Log in as staff — open Members list — open a member detail page | | |
| ☐ | Confirm `/admin`, `/app`, `/admin-mobile` return 404 on the live domain | | |
| ☐ | Load a random nonexistent URL — confirm branded 404 page (not framework default) | | |
| ☐ | Check homepage, login, and dashboard on a mobile viewport | | |
| ☐ | Submit the contact form — confirm staff notification email arrives | | |
| ☐ | Remove the test signup account once verified | | |

## 3. First 24 hours monitoring

| ✓ | Task | Owner | Evidence of completion |
|---|---|---|---|
| ☐ | Watch logs for `[stripe webhook] could not cancel previous subscription` | | |
| ☐ | Watch logs for `[stripe webhook] Membership charge refunded — staff review required` | | |
| ☐ | Watch logs for `[email] Send failed` | | |
| ☐ | Confirm `data/db.json` is updating between requests | | |
| ☐ | Watch for repeated `429`s on `/api/auth/login` or `/api/auth/forgot-password` | | |
| ☐ | Confirm no traffic reaching `/admin`, `/app`, `/admin-mobile` | | |
| ☐ | Check Stripe webhook delivery log for failures | | |
| ☐ | Confirm at least one real member completes signup → login → booking | | |
| ☐ | Confirm the cron job fired and `/api/cron/run` returned success | | |

## 4. Do-not-launch-until gate

| ✓ | Task | Owner | Evidence of completion |
|---|---|---|---|
| ☐ | All credentials rotated | | |
| ☐ | Deployment confirmed persistent, not serverless | | |
| ☐ | `data/` backups confirmed | | |
| ☐ | Live Stripe payment confirmed: webhook 200, expected app state | | |
| ☐ | Real password-reset email received in a real inbox | | |
| ☐ | `/admin`, `/app`, `/admin-mobile` confirmed 404 on the live domain | | |
| ☐ | Demo/seed accounts removed or repointed | | |

## 5. Placeholder content to confirm

| ✓ | Task | Owner | Evidence of completion |
|---|---|---|---|
| ☐ | `CONTACT_INFO` in `lib/content.ts` (location, email, phone) — confirm or replace | | |
| ☐ | `DIFFERENTIATORS` copy in `app/page.tsx` — confirm the "every coach is degree-qualified" claim is accurate, or edit it | | |

## 6. Demo-account cleanup

| ✓ | Task | Owner | Evidence of completion |
|---|---|---|---|
| ☐ | Remove `alex@demo.local`, `jordan@demo.local`, `sam@demo.local`, `taylor@demo.local`, `morgan@demo.local`, `riley@demo.local` | | |
| ☐ | Repoint `coach@demo.local` to a real staff account — don't delete until a real admin account exists | | |
| ☐ | Remove `paytest@demo.local` | | |
| ☐ | Remove any test accounts created during smoke testing | | |
| ☐ | Confirm at least one real `admin_manager` account exists before removing the demo staff account | | |
