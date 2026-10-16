# The App Subscription (digital plan): contract, persistence changes and what is and is not proven

**Date:** 2026-10-16. **Branch:** `release/launch-2026-10-digital`. **Replaces** the "membership includes the digital features" assumption that `lib/member-access.ts` encoded as a ranked tier.
Nothing here is deployed, enabled or run against a store. Both purchase kill switches are OFF by default and stay off until an operator sets them.

## Owner decisions this implements (2026-10-15)

| | Decision |
|---|---|
| D1 | Digital features are NOT included with a gym Membership. The App-only digital plan is a separate subscription. |
| D2 | Launch storefronts: Ireland, United Kingdom, United States, Canada, Australia, New Zealand, South Africa. Do not enable others automatically. (A store-console setting, not code: see the owner checklist.) |
| D3 | There is no website purchase flow for the App-only plan. It is bought through Google Play or the App Store only. |

## The model

A member has two independent facts (`lib/member-access.ts`, mirrored in the mobile app):

* `gymMembership`: an active or past_due `SubscriptionRecord` on a non-app-only package. Unchanged storage, unchanged Stripe/Revolut flows.
* `digital`: at least one **live** `DigitalEntitlementRecord` (`lib/digital-entitlement.ts`), or a legacy complimentary row (below).

Every gated feature requires `digital`. Coach messaging and staff visibility of member data require `gymMembership`. The server computes both on every request from verified records; the client's copy only decides what to draw.

### Digital entitlement rows (one per user and source)

| source | created by | changed by | access while |
|---|---|---|---|
| `google_play` | the verified Google Play claim | Google notifications (RTDN), reconciliation | status `active`/`canceled` and paid-through time (+10 min tolerance for event ordering) not passed; `in_grace_period` until its end, never more than 30 days past the last paid time |
| `app_store` | the verified App Store claim | App Store Server Notifications V2, reconciliation | same rules (a grace row's end is Apple's `gracePeriodExpiresDate`) |
| `staff_grant` | staff: "grant complimentary digital access", or an invite | staff withdraw; optional end date | until withdrawn or its end date |

`on_hold`, `paused`, `expired` and `revoked` never grant access. Status is never read alone: a row still saying `active` after its paid time (a lost notification) stops granting access by itself.

**One paid store subscription per account.** A second one from the other store is refused (`other_store_active`); a second one in the same store on a different original transaction / purchase token while the first is live is refused (`subscription_already_active`); once the first has ended, a new one takes over. A staff grant is a separate row and never blocks or is replaced by a purchase. A paid row is only ever written by the store services; staff can never create, change or end one.

## Server routes

| Route | Purpose |
|---|---|
| `GET /api/mobile/billing/catalog` | Store product ids per billing period. **No price**, ever. |
| `GET /api/mobile/billing/google-play/purchase-context` / `.../app-store/purchase-context` | The account binding the app must put on the purchase: Google `obfuscatedAccountId`, Apple `appAccountToken` (a UUID derived by HMAC from the account and a server secret). |
| `POST /api/mobile/billing/google-play/verify` (`purchaseToken`) / `.../app-store/verify` (`signedTransaction`) | Verifies and claims. Also used for Restore (idempotent for the owner). |
| `POST /api/webhooks/google-play?token=` / `POST /api/webhooks/app-store` | Lifecycle notifications. |
| Jobs `reconcile-google-play-purchases`, `retry-google-play-acknowledgements`, `reconcile-app-store-purchases` | Lost-notification safety net. |
| `POST /api/staff/members/[userId]/tier`, `.../bulk-tier` | Staff: `membership`, `free` (end the gym Membership), `app_subscription` (grant COMPLIMENTARY digital access), `digital_revoke`. |

Stable failure codes the app depends on: `iap_disabled`, `not_configured`, `binding_unavailable`, `invalid_request`, `owned_by_other`, `binding_required`, `provider_unavailable` (502, retry), `provider_rejected`, `product_unknown`, `purchase_pending`, `subscription_already_active`, `other_store_active`, `environment_not_accepted`. No response contains a token, a transaction id or provider text.

## What cannot happen (each has a test)

* A purchase is granted to an account other than the one that started it: the transaction must carry **that account's** binding; a purchase already owned by another account is refused before the store is asked; a refused claim binds nothing and acknowledges nothing; Restore as a different account is refused with `owned_by_other`.
* Access from anything the client reports: a client-supplied transaction is verified against Apple's pinned root (App Store) or re-read from Google (Play), and its state is re-read from the store before anything is written.
* A forged, altered, re-signed or foreign-chain Apple payload is accepted: the verifier checks the algorithm, a 3-certificate chain, validity, each link, **a pinned root compared as a whole certificate**, Apple's marker extensions on the leaf and intermediate, then the ES256 signature. Nothing is pinned in code; with no root configured, nothing is trusted.
* A notification's type decides state: it is only a signal to re-read. The one thing taken from a notification is a revocation date Apple stamped on the signed transaction, honoured only for the current transaction.
* Duplicates and reordering: notification ids are recorded once; an older answer than the newest applied is dropped (tested with a gated slow call).
* A paid entitlement is withdrawn late: reconciliation re-asks the store, and the access rule stops at the paid time regardless.
* A staff action ends or alters a paid subscription: there is no such path; staff can only grant and withdraw a complimentary row, shown as complimentary everywhere.
* The digital plan is bought on the website, or written into a Membership row: web checkout, staff activation and the staff override all refuse the app-only package (`app_plan_not_assignable`).
* A gym Membership blocks, replaces or is replaced by a purchase: the two never share a row.

## Sandbox policy (Apple)

App Review and TestFlight purchases are **sandbox** transactions. `APP_STORE_ACCEPT_SANDBOX` is an explicit, per-deployment switch, default off. A sandbox purchase is stored with `environment: "sandbox"`, is read from Apple's sandbox host, is shown to staff and in reports, and is **never** recorded as revenue. `Xcode` and `LocalTesting` transactions are never accepted. Whether the production deployment accepts sandbox during review is an owner decision (see the checklist): accepting means a sandbox tester account the owner created can obtain access on production for as long as the switch is on.

## Persistence changes (for review: nothing here is a new storage architecture)

Additive, same single-file datastore, same lock, same `writeDb` path. No migration is required to deploy; nothing is rewritten on first read.

| Change | Detail |
|---|---|
| New collection `digitalEntitlements` | one row per `(userId, source)`; defaults to `[]` in the normaliser and `emptyDatabase`; classified `user("userId")` in `lib/resource-scope.ts`; in the hard-delete owned list |
| New collection `appStorePurchases` | one row per original transaction id; anonymised (never deleted) on hard delete, exactly like `googlePlayPurchases`; hard delete is refused while a paid subscription is running |
| New optional field `appStoreProductId` on billing options | defaults to `null` |
| New audit event types and providers | `iapEvents` is append-only as before; providers `app_store` and `staff` added; transaction ids only as hashes |
| `iapNotifications` | reused, with the key prefix `appstore:` for Apple notification ids |
| Legacy rows | a complimentary App Subscription recorded as a `SubscriptionRecord` on the app-only package with `provider: "none"` keeps granting digital access (read through, not migrated). Granting a gym Membership to such a member first carries the comp into a `staff_grant` row so access is not silently lost. A legacy row billed through Google Play is **not** honoured: in-app purchases were never enabled anywhere, so no such row can be a real paid subscription. |
| Scripts | `delete-members.mjs` and `delete-non-staff.mjs` mirror the new protection and anonymisation; `iap-report.mjs` reports the new collections (counts only); `seed-app-subscription-package.mjs` reads Apple product ids from the environment only |
| Older builds | the datastore already carries unknown top-level keys through a rewrite, so an older build running briefly against a datastore that has these collections does not delete them |

Concurrency: every claim and notification does its provider call first and then decides and writes in one synchronous section (no `await` between reading the rows it depends on and writing), the same pattern the Google Play service already used. The await-gap inventory (`scripts/audit-await-gaps.cjs --check`) is unchanged and passes. The cutover procedure in `docs/datastore-first-deployment.md` applies unchanged: the new collections travel in the same `db.json`.

## Test status (be precise)

| Layer | State |
|---|---|
| Entitlement rules, access flags, staff actions, web lockdown, legacy handling | **Tested locally, real datastore, real route handlers** |
| Google Play lifecycle | **Tested locally with a fake provider** (existing suite, converted). Never run against Google. |
| App Store lifecycle (binding, ownership, forged payloads, sandbox policy, grace/retry/refund, duplicates, out-of-order, reconciliation, deletion) | **Tested locally**: real signature and certificate-chain verification against **generated test chains** (`__tests__/fixtures/app-store/gen.sh`, nothing is Apple's), with only "read this subscription's state from Apple" faked. Never run against Apple. |
| App Store Server API client | **Tested locally with `fetch` replaced**: request URL and host per environment, a valid ES256 token built from a generated key, response verification, error mapping. Never sent to Apple. |
| Apple's real root and chain | **NOT tested.** The pinned root comes from configuration; the real Apple root has not been downloaded or fingerprint-checked here. A real signed transaction has never been verified. |
| Store sandbox (Apple sandbox, Google licence testers) | **NOT tested.** |
| Real charges / live providers | **None, by instruction.** |
