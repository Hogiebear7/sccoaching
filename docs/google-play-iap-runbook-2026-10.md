# Google Play App Subscription: operations runbook (2026-10-07)

**Status:** written, **never exercised**. No step below has been run against Google, a staging environment or production.
Treat it as a checklist to verify during the first staging run, and correct it where reality differs.
Contract and state machine: `docs/google-play-server-contract-2026-10.md`. Plan and owner defaults:
`docs/iap-multitenant-implementation-plan-2026-10.md`.

**Rules for anyone following this:** never paste a purchase token, service-account JSON, `SESSION_SECRET`, an RTDN token or
a `data/db.json` extract into a ticket, chat or log. Never edit `data/db.json` by hand. Back it up first, always.

## 1. Switches

| Variable | Default | Effect |
|---|---|---|
| `GOOGLE_PLAY_IAP_ENABLED` | unset (**off**) | exactly `true` accepts new purchases |
| `GOOGLE_PLAY_IAP_ENVIRONMENT` | unset (**off**) | exactly `test`, `staging` or `production` |
| `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`, `GOOGLE_PLAY_RTDN_TOKEN` | unset | provider credentials; without them the provider is "not configured" |

Purchases are accepted only when **both** `GOOGLE_PLAY_IAP_*` variables are valid. Notifications, reconciliation and
acknowledgement retry run regardless, so access can always be withdrawn.

### Stop new purchases now

Unset `GOOGLE_PLAY_IAP_ENABLED` (or set it to anything but `true`) on the deployment and restart or redeploy so the
process picks up the environment. New verify and purchase-context calls then answer `503 iap_disabled`. Members who
already subscribed keep access. A member who paid but whose claim was not yet verified keeps the token on their phone and
is verified when you turn it back on (the app retries on start and on return to foreground). Google refunds a purchase
that is never acknowledged (provider confirmation required for the window).

## 2. First staging run (never done)

1. Use a **staging** deployment with its own datastore and its own Pub/Sub push subscription and shared secret.
2. Set the three provider credentials and both `GOOGLE_PLAY_IAP_*` variables (`staging`) **on staging only**.
3. Seed the App Subscription package with `npm run seed:app-subscription-package -- --confirm` against the **staging**
   datastore, with `GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID` set for the seed.
4. In Play Console, add a licence tester. Install a development build of the mobile app (it needs the billing library, which
   is not yet in the app) signed in as a staging member.
5. Walk the journeys in `__tests__/e2e/google-play-end-to-end.test.ts` against real Google: buy, renew (use the test
   renewal speed-up), cancel, let it lapse, refund, grace and hold if the test track allows.
6. After each step run `node scripts/iap-report.mjs` against a **copy** of the datastore, and compare with the contract's
   state table. Record every difference. Fix the mapping in `lib/providers/google-play.ts` where Google differs.
7. Confirm what Google does with an unacknowledged, refused purchase, and the real acknowledgement window.

## 3. Reading the report

```bash
GYM_DB_PATH=/path/to/COPY-of-db.json node scripts/iap-report.mjs
```

Read-only. Counts only: no id, token, hash, order id or binding is printed.

| Line | Meaning | Action |
|---|---|---|
| `unacknowledged` greater than 0 for more than a few minutes | the acknowledgement retry job has not succeeded | check the job ran (Operations page, or the housekeeping runner), the provider credentials, and `acknowledgement failed` |
| `acknowledgement attempts at cap (10)` | retries exhausted; Google will refund it | find out why Google rejected acknowledgement; a refund by Google is the expected outcome |
| `marked active but past expiry` | a notification was lost and reconciliation has not caught up | run the reconciliation job; if it stays, check credentials and the provider |
| `never reconciled or snapshot over 24h old` | the reconciliation job is not running | check the job registry and the housekeeping schedule |
| `revoked` | refunds or voids applied | expected; see section 5 |
| `legacy rows without the IAP fields` | rows from before the new fields | optional backfill, section 6 |
| `Notifications: not completed (retrying)` | Pub/Sub deliveries awaiting a successful provider call | transient provider failure; reconciliation covers the rest |
| `Audit events`: many `claim_rejected_binding` | clients are not setting the account binding, or someone is probing tokens | check the app build; none of these bind anything |
| `Audit events`: many `claim_rejected_conflict` | members with an active Membership are reaching the paywall | check the app hides it; no money moves (Google refunds) |

## 4. Symptoms

| Symptom | Likely cause | What to do |
|---|---|---|
| A member says they paid and have no access | claim not yet verified (kill switch off, provider down, or app closed) | check the kill switch and provider health; the app retries on next start. If the report shows nothing for them and Google shows a charge, ask them to open the app and use **Restore purchase** |
| Verify answers `binding_required` for an honest member | the client did not set `obfuscatedAccountId` from the purchase-context call, or `SESSION_SECRET` changed after the purchase started | section 7 |
| Verify answers `owned_by_other` | the token is already bound to a different app account | **Never reassign a token.** Treat as a support case; decision 7 (no transfers) is the default |
| Verify answers `membership_active` | the member has an active gym Membership | by design (D1). Nothing was acknowledged, so Google refunds it. Staff end the Membership first if the member wants the App Subscription |
| Staff get `play_billing_active` | a live Google Play subscription | by design. The member cancels in Google Play; access continues to the paid expiry |
| A member kept access after refunding | the voided-purchase notification did not arrive or did not match the current order | reconciliation re-checks. If Google does not report the state as ended, **this needs the real-provider verification in section 2** |
| A member says they were charged by Stripe or Revolut but their access is on Google Play, and the audit report shows `provider_conflict_rejected` | the cross-provider guard refused that provider's completion because a Play entitlement was live | **Do not edit the datastore.** Cancel the refused subscription at Stripe or Revolut by hand, and refund it if that is the decision. No automatic cancel or refund exists. The member keeps the Play entitlement. Owner decision on policy is open |

## 5. Refunds and revocations

A voided-purchase notification for the purchase's **current** order ends access at once and the purchase stays void. A void
of an earlier period changes nothing. The purchase row, the audit events and the revenue booking are kept; **nothing is
reversed in the revenue records** (revenue recognition is an open accounting decision, D8). Who handles refund requests and
whether access is cut immediately are owner decisions 5 and 6, **not made**.

## 6. Backfill (optional)

```bash
node scripts/backfill-google-play-purchase-iap-fields.mjs --report     # read-only
node scripts/backfill-google-play-purchase-iap-fields.mjs --confirm    # backs up first
```

Run `--report` on a copy first. Do not run `--confirm` on production data without owner approval.

## 7. Secrets and rotation

- **`SESSION_SECRET` is also the key behind the account binding.** Rotating it logs everyone out **and** changes every
  user's expected binding, so a purchase that was started but not yet verified will be refused (`binding_required`). Turn
  the kill switch off first, wait for in-flight purchases to be verified, then rotate (readiness finding GP-12).
- **`GOOGLE_PLAY_RTDN_TOKEN`** rotates by changing the environment value and the push endpoint URL together. The token is in
  a URL, so it can appear in access logs. Keep logs restricted.
- **Service-account key**: rotate in Google Cloud, update `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`. While it is wrong,
  fetches fail with `unauthorized`, the reconciliation job stops early, and notifications return 502 until it is fixed.

## 8. Rollback

All schema changes are additive and optional. To stop the feature: turn the kill switch off. To remove the code: revert the
PRs in reverse order (the stack in `docs/iap-implementation-status-2026-10.md`). Older code ignores the extra fields and
collections. The backfill writes a timestamped backup before it changes anything.

## 9. Not covered, and why

Account deletion with an active subscription (owner decision 6), merchant and account ownership (4), refund responsibility
(5), revenue basis and recognition (3, D8), the member who paid at a provider whose completion was refused (see section 4), and
production enablement. Each is an open owner decision; none is implemented or assumed here.
