# Google Play App Subscription: server contract (2026-10-07)

**Status:** implemented and tested against a **fake provider adapter** and a temporary datastore in PR 4
(`feat/google-play-provider-and-lifecycle`, stacked on PR 3 and PR 2). **Nothing here has been run against Google.**
Every Google-specific behaviour is listed in section 9 as requiring real-provider verification.
**Plan and owner defaults:** `docs/iap-multitenant-implementation-plan-2026-10.md`. **Readiness analysis:**
`docs/google-play-iap-readiness-2026-10.md`. **Conflict rules and schema:** `docs/iap-entitlement-schema-and-membership-conflict-2026-10.md`.

Android and Google Play only (D6). There is no Apple provider, and the code does not pretend one exists. The service
talks to a provider-neutral adapter (`lib/iap/adapter.ts`), so a future iOS provider is a new adapter plus a new
service entry point, not a change to the rules.

## 1. Endpoints

All three authenticate the caller; none reads a user id, gym id or account binding from the request.

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/mobile/billing/google-play/purchase-context` | session | Returns the one-way account binding the client must set before launching the purchase flow |
| `POST /api/mobile/billing/google-play/verify` | session | Verifies a purchase token with Google, binds it to the session user, grants the entitlement, acknowledges |
| `POST /api/webhooks/google-play?token=…` | shared secret in the URL | Pub/Sub push of real-time developer notifications (RTDN) |

### 1.1 `GET purchase-context`

Success `200`:

```json
{ "success": true, "data": { "obfuscatedAccountId": "<64 hex>", "environment": "test|staging|production" } }
```

The client passes `obfuscatedAccountId` to the Billing Library's `setObfuscatedAccountId` before it launches the
purchase flow. It is a one-way HMAC of the session user id (`lib/providers/google-play.ts`), never a raw id and never
PII. It is returned only to the session user.

| Status | `code` | When |
|---|---|---|
| 401 | none | no session |
| 503 | `iap_disabled` | kill switch off or environment unset |
| 503 | `not_configured` / `binding_unavailable` | provider or `SESSION_SECRET` not configured |
| 409 | `membership_active` | the member has an active gym Membership, so no purchase intent may start (D1) |
| 409 | `play_billing_active` | the member already has a live Google Play subscription |

### 1.2 `POST verify`

Body: `{ "purchaseToken": "<string, 1 to 4096 chars>" }`. Anything else in the body is ignored.

Success `200`:

```json
{ "success": true, "message": "Purchase verified.", "data": { "tier": "app_subscription", "status": "active", "acknowledged": true } }
```

Failure bodies are always `{ "success": false, "code": "<stable>", "message": "<safe text>" }`. **The client must
branch on `code`, never on `message`.**

| Status | `code` | Meaning | Client should |
|---|---|---|---|
| 400 | `invalid_request` | missing, blank, non-string or oversized token | fix the call |
| 400 | `provider_rejected` | Google does not recognise the token | show "could not be verified" |
| 400 | `product_unknown` | the product or base plan is not a known App Subscription | show "could not be verified" |
| 401 | none | no session | sign in |
| 409 | `binding_required` | a new token without this account's binding (missing, malformed or mismatched are one answer) | the purchase flow did not set the binding. Do not retry blindly |
| 409 | `owned_by_other` | the token is already bound to another account. Never reassigned | show "already linked to another account" |
| 409 | `membership_active` | an active Membership exists. Nothing created, not acknowledged | explain; direct to the gym |
| 409 | `play_billing_active` | a different live Play subscription already exists | explain |
| 409 | `purchase_pending` | Google reports the purchase as pending | poll later; entitlement arrives by notification |
| 500 | `not_set_up` | the App Subscription package is missing | contact support |
| 502 | `provider_unavailable` | timeout or provider outage (retryable) | retry with backoff |
| 503 | `iap_disabled` / `not_configured` | kill switch off or provider not configured | treat as "not available right now" |

Rules the service enforces (`lib/iap/service.ts`):

1. **Kill switch first.** Off means `iap_disabled`, an audit event, and no provider call.
2. **Ownership gate before any provider call.** A token bound to another account is rejected without contacting Google.
3. **Provider answers, then one synchronous section.** After Google answers there is no `await` until the purchase
   row, the subscription row and the audit events are written, so no other request interleaves. The ownership check is
   repeated inside that section (a token claimed while this request was waiting is refused).
4. **First valid binding wins.** A token with no owner must echo the session user's binding, compared in constant time.
   A token the session user already owns is idempotent and needs no binding (restore purchases).
5. **No overlap, decided before a purchase row exists.** A refused claim creates nothing, binds nothing and does not
   acknowledge, so Google will refund it itself (I5; the three-day window is in code comments and needs provider
   confirmation).
6. **Entitlement only after verification (D5), acknowledgement only after entitlement.**
7. **Revenue** is booked once per Google order id at the configured placeholder price. The amount basis is an open
   accounting decision (D8). This records technical facts only.

### 1.3 `POST /api/webhooks/google-play`

| Status | When |
|---|---|
| 401 | missing or wrong `?token` |
| 200 | everything considered: applied, duplicate, test, wrong app, unknown token, pending, not recognised by Google, gave up |
| 502 | a transient Google failure. Pub/Sub redelivers, with the same message id |
| 503 | the provider is not configured |

Idempotent by Pub/Sub **message id**: a completed message is skipped, one that never completed is retried and counted.
After `MAX_NOTIFICATION_ATTEMPTS` (8) failed deliveries it answers `200` and leaves the purchase to reconciliation. A
notification for another package name is ignored. A notification for an unknown token is ignored (it may beat the
client's claim, which fetches fresh state itself). No response contains a purchase token or provider text.

## 2. Lifecycle state machine

The notification type is **never trusted for the state**. Every notification triggers a live fetch, and the mapping below
is applied to what Google returns (`mapGooglePlaySubscriptionState`).

| Google state | Purchase `status` | Subscription `status` | Access |
|---|---|---|---|
| active | `active` | `active` | yes |
| in grace period | `in_grace_period` | `past_due` | yes (member keeps access while Google retries) |
| on hold | `on_hold` | `canceled` | **no** (conservative) |
| paused | `paused` | `paused` | per existing pause rules |
| canceled (auto-renew off), expiry in the future | `canceled` | `active` | **yes, until the paid expiry** (D5) |
| canceled, expiry passed | `canceled` | `canceled` | no |
| expired | `expired` | `canceled` | no |
| pending, unspecified, unknown | recorded | **unchanged** | no change (no grant on a state we do not understand) |
| **voided current order** (refund, chargeback) | any | `canceled` | **no, immediately; stays void** |

- **Refund and revocation.** A voided-purchase notification for a subscription (`productType` 1) whose `orderId` is the
  purchase's **current** order sets `revokedAt` and `revocationReason: "voided"` and ends access. A void of an earlier
  period's order changes nothing. A voided one-time product is ignored. Once revoked, **no later snapshot, notification
  or re-verify can re-entitle** the purchase. History (the purchase row, events, revenue booking) is kept.
- **Access at the paid expiry without any notification.** `resolveMemberTier` returns Free for an `active` Google Play
  row whose `currentPeriodEnd` passed more than 10 minutes ago (tolerance for event ordering, not a grace period), and
  the reconciliation job then corrects the row.
- **Stale tokens cannot rewrite the row.** A snapshot or notification for a token that is neither the token the row is
  billed through nor its direct successor (`linkedPurchaseToken`) never overwrites a live entitlement and never
  replaces a row with a non-entitling state. The purchase's own history is still updated.
- **Snapshot ordering.** Each provider answer carries the time its call was issued. An older answer than the newest one
  applied is dropped and audited (`notification_stale`).
- **Manual App Subscription.** The member's own verified claim may replace a manual App Subscription (one row, so no
  overlap). A notification for an older token never does.

## 3. Acknowledgement

Google refunds a subscription purchase that is not acknowledged within three days (**provider confirmation required**).

- Acknowledged after the entitlement is written, in the verify path and opportunistically in the notification path.
- A failed attempt does **not** withdraw the entitlement. It records `acknowledgementState: "failed"`, a short error
  code (never provider text) and the attempt count.
- `retry-google-play-acknowledgements` (registered job) retries entitled, unacknowledged, unrevoked purchases with a
  15-minute minimum interval, a cap of 10 attempts, and no attempts once the purchase is 2.5 days old.
- A refused claim is never acknowledged, and a revoked purchase is never acknowledged.

## 4. Reconciliation

`reconcile-google-play-purchases` (registered job) re-fetches purchases whose last snapshot is over 6 hours old, or that
are still active, cancelled or in grace after their expiry, 25 per run. It stops early if Google rejects the credentials
or the provider is unconfigured, and writes a `reconciliation_run` audit event. It runs whether or not the kill switch
is on.

## 5. Kill switch and configuration (D7)

Names only. **No value belongs in this repository, in a log, or in a document.**

| Variable | Meaning |
|---|---|
| `GOOGLE_PLAY_IAP_ENABLED` | exactly `true` to accept new purchases. Unset or anything else is **off** (the default) |
| `GOOGLE_PLAY_IAP_ENVIRONMENT` | exactly `test`, `staging` or `production`. Unset or anything else is off |
| `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`, `GOOGLE_PLAY_RTDN_TOKEN` | provider credentials, unchanged |

The switch gates new claims and the purchase context. It deliberately does **not** gate notifications, reconciliation or
acknowledgement retry, so access can always be withdrawn (I6). There is no setting that selects the fake adapter: a
deployment cannot be switched onto it by configuration.

## 6. Audit

`iapEvents` (append-only) records: `purchase_claimed`, `claim_rejected_owner`, `claim_rejected_binding`,
`claim_rejected_conflict`, `claim_rejected_product`, `claim_rejected_disabled`, `entitlement_granted`,
`entitlement_updated`, `entitlement_revoked`, `entitlement_expired`, `acknowledgement_succeeded`,
`acknowledgement_failed`, `notification_stale`, `reconciliation_run`, `staff_write_rejected`. It holds the SHA-256 of a
purchase token, never the token, a binding value or provider text (tests assert it).

## 7. Tenant and authorization notes

The session user is the only identity used. A notification changes only the row of the token's persisted owner. The App
Subscription is platform-global (`deliveryChannel: "app_only"`), and the owner's gym is not consulted for entitlement.
Routes are classified in `lib/route-scope-manifest.ts` (`self` for verify and purchase-context, `webhook` for RTDN).

## 8. Rollback

All schema changes are additive. To stop purchases, unset `GOOGLE_PLAY_IAP_ENABLED` (no deploy needed beyond the
environment change). To remove the feature, revert the PR: the extra fields and collections are ignored by older code.

## 9. What is implemented, tested, and still unverified

| Item | Status |
|---|---|
| All rules in sections 1 to 6 | **Implemented, tested with a fake provider and a real temporary datastore** |
| Provider failure handling (timeouts, closed error codes, no text pass-through) | Implemented, tested with a mocked `fetch` |
| Shape of Google's `subscriptionsv2` and voided-purchase payloads, the exact `subscriptionState` and `canceledStateContext` values after a refund, `productType` and `refundType` semantics | **Requires real-provider verification on the Play internal test track.** Written from Google's documentation, not observed |
| That a voided current order should end access immediately, and that a refund without revocation exists | **Owner decision plus real-provider verification** |
| The three-day acknowledgement refund window | **Requires provider confirmation** |
| Pub/Sub delivery behaviour (ordering, redelivery) | **Requires staging** |
| Revenue amount basis and revenue recognition | **Open owner and accounting decision** |
| Account deletion with an active subscription, and who handles refunds | **Open owner decisions 5 and 6** |
| A Stripe or Revolut checkout that completes after a Play purchase (it would overwrite the row) | **Open, owner decision required** (the member has already paid) |
| Production enablement | **Requires production approval.** Nothing in this repository enables it |

### Staging checklist (not performed by this work)

1. Set the three provider credentials and the two `GOOGLE_PLAY_IAP_*` variables **on a staging deployment only**.
2. Point the Pub/Sub push subscription at the staging URL with its own shared secret.
3. With a Play licence tester: purchase, cancel, let it lapse, refund, and run grace and hold if the test track allows.
4. Compare each observed payload and state with section 2 and fix the mapping where Google differs.
5. Confirm the acknowledgement window and that an unacknowledged, refused claim is refunded by Google.
6. Only then ask the owner about production.
