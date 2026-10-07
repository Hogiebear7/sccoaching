# App Subscription entitlement schema and Membership conflict rules (2026-10-07)

**Status:** implemented and tested with mocks / a temporary datastore in PR 3
(`feat/iap-entitlement-schema-and-membership-conflict`). **Not verified against Google Play.**
**Base:** PR 2 (`feat/tenant-context-and-route-scope-guard`). PR 3 is stacked on PR 2 because the
collection registry in PR 2 is typed against every datastore collection, so a PR that adds a collection
must build on it. This changes the plan's table, which listed PR 3 as independent.
**Plan:** `docs/iap-multitenant-implementation-plan-2026-10.md`. **Rules source:** owner defaults D1 to D8 there.

## 1. What changed

| Area | Change |
|---|---|
| Schema | Optional fields on `GooglePlayPurchaseRecord`: `purchaseTokenHash`, `boundAt`, `acknowledgementState`, `acknowledgementAttempts`, `acknowledgementLastAttemptAt`, `acknowledgementError`, `lastSnapshotAt`, `revokedAt`, `revocationReason`. Two new collections: `iapEvents` (append-only audit) and `iapNotifications` (message-id dedupe) |
| Datastore helpers | `claimGooglePlayPurchase` (first valid binding wins), `applyGooglePlayPurchaseSnapshot` (ordering guard), `appendIapEvent`, `findIapEvents`, `claimIapNotification`, `completeIapNotification`, `hashPurchaseToken`, `sanitizeIapDetail` |
| Conflict rules | `lib/iap/entitlement-conflict.ts`: one pure rule set plus a datastore-backed entry point |
| Enforced at | `grantMemberTier` (staff tier route, bulk tier, invite redemption, the free downgrade used by the drop-lapsed job), `POST /api/admin/membership/activate`, `POST /api/staff/members/[userId]/subscription`, the fresh-join branch of `POST /api/membership/checkout` |
| Tier resolution | `resolveMemberTier` returns Free for an `active` Google Play row whose paid period ended more than 10 minutes ago |
| Backfill | `scripts/backfill-google-play-purchase-iap-fields.mjs`, dry run by default |
| Registry | `lib/resource-scope.ts` classifies the two new collections |

## 2. Conflict rules

A member has exactly one `SubscriptionRecord`. A write that replaces it must not silently replace a live
entitlement of the other kind, or a live Google Play subscription. Every refused write answers **409 with a
stable `code`**, changes nothing, and appends a `staff_write_rejected` event.

"Live" means status `active`, `past_due` or `paused`, a package that still resolves, and, for `active`, a
paid period that has not ended (interpretation I3). `pending`, `inactive`, `canceled` and a lapsed `active`
row are not live.

| Existing row (live) | Incoming write | Result |
|---|---|---|
| Membership | entitling App Subscription (manual grant, admin activation, override) | `membership_active` |
| Membership | Google Play claim | `membership_active` (enforced by the PR 4 verify path) |
| manual App Subscription | entitling Membership | `app_subscription_active` |
| Google Play App Subscription | **any** staff write: Membership, App Subscription, Free, status change | `play_billing_active` |
| anything not live, or no row | any write | allowed |
| same kind, manual | refresh, or downgrade to Free | allowed |

| Code | Staff-facing message (stable) | Member-facing message (checkout, invite) |
|---|---|---|
| `membership_active` | already has an active gym Membership, so an App Subscription can't be added while it is active | You already have an active gym Membership... |
| `app_subscription_active` | already has an active App Subscription. End it first, then add the Membership | Let it end before starting a Membership |
| `play_billing_active` | billed through Google Play; can only be cancelled there; access continues until the paid period ends | Cancel it in Google Play and you can start a Membership once it has ended |

No message contains an id, a date or provider detail. A cross-tenant target is still answered by the
ordinary `404 "Member not found."` before any conflict is evaluated, so a conflict never confirms that a
guessed member exists in another gym.

Nothing is converted, cancelled, refunded or reassigned automatically (D2). The two explicit steps for staff
are: end a manual App Subscription (set Free), then grant the Membership. A Google Play subscription ends
only when the member cancels it in Google Play, and access continues to the paid expiry.

An invite that hits a conflict stays **pending** (it is not consumed) and the member sees a neutral message.

## 3. Schema and helper contracts

- **First valid binding wins (D3).** `claimGooglePlayPurchase` checks and inserts in one synchronous step.
  No row: insert bound to the claimant. Same account: return the existing row unchanged (idempotent, no
  event). Another account: change nothing, append `claim_rejected_owner`. A token is never reassigned.
  The caller must verify the account binding before calling.
- **Snapshot ordering.** `applyGooglePlayPurchaseSnapshot(token, fields, snapshotAt)` takes the time the
  provider call was **issued**. A snapshot older than the newest applied one is stale: it writes only a
  `notification_stale` event. An equal timestamp applies, so retrying the same snapshot is idempotent. Only
  lifecycle keys are copied, at runtime as well as in the type, so ownership fields are unreachable.
- **Audit.** `iapEvents` is append-only: nothing in `lib/db.ts` updates or deletes a row. A raw purchase
  token is hashed on the way in. `sanitizeIapDetail` drops any key that names a secret or personal field,
  truncates strings to 120 characters and caps the key count at 12.
- **Notification idempotency.** `claimIapNotification(messageId)` returns `new`, `retry` (delivered but never
  completed) or `duplicate` (completed). Completed rows older than 30 days are pruned on each claim.
- **Stale token.** `isCurrentPlayToken(row, token)` is true only for the token the row is billed through. PR 4
  uses it so a notification for any other token cannot rewrite the row.

## 4. Migration notes

All changes are additive and optional. `readDb` defaults the two new collections to empty arrays and treats
every new purchase field as absent on an old row, so an existing `db.json` loads and behaves as before with
no migration step. The backfill is optional and fills only absent fields from data the row already holds:

```bash
node scripts/backfill-google-play-purchase-iap-fields.mjs --report    # read-only, counts only
node scripts/backfill-google-play-purchase-iap-fields.mjs --confirm   # backs up to <db>.bak-<ts> first
```

Run `--report` against a copy first. Do not run `--confirm` against production data without owner approval.
This work did not read or write `data/db.json`.

**Rollback.** Reverting the code leaves the extra fields and collections in the file, where older code ignores
them. The backfill writes a timestamped backup before it changes anything, and re-running it is idempotent.

## 5. Security notes

- **Tenant:** nothing here takes a client-supplied gym id. Conflict evaluation reads the target member's own
  row after the same-gym check each route already performs.
- **Secrets:** no purchase token, binding value or provider message is stored in `iapEvents`. The tests assert
  the raw token never appears in the file.
- **Failure mode:** every refusal is fail-closed (no write). The only new write on a refusal is the audit event.

## 6. Known gaps (not closed by this PR)

| Gap | Where it is handled |
|---|---|
| The existing Google Play **verify** route and **notification** route still apply a Play purchase through `grantMemberTier`'s provider path, which deliberately skips these rules. A Play claim over an active Membership is therefore **not yet refused** on that path, and a stale-token notification can still overwrite the row | **Closed by PR 4** (stacked on this one), which replaces both routes with `lib/iap/service.ts`. See `docs/google-play-server-contract-2026-10.md`. **Do not enable the Play flow from this PR alone**; there is no purchase flow in the mobile app today, so nothing reaches it |
| A Stripe or Revolut checkout started while the member had nothing live can complete after they buy through Google Play | **Closed by the cross-provider guard (section 7).** The completion is now refused and audited while another provider's entitlement is live. What to do for the member who paid in that case (cancel and refund at the refused provider) is a manual staff action and an **open owner decision**; no automatic cancel or refund exists |
| Hard-deleting an archived member removes their `googlePlayPurchases` rows, which frees the token for another account to claim | Owner decision 6 (account deletion with an active subscription) is open. `iapEvents` is kept after deletion for the same reason |
| `grantMemberTier` has no actor id, so a refused write's event has `actor: "staff"` and no staff user id | Low value to fix before the audit-reader exists |
| Counting a `paused` Membership as active means a member on a pause cannot take an App Subscription | Interpretation I3, owner to confirm |
| The 10-minute tolerance on Play expiry is a judgement about event ordering, not a policy | Owner to confirm |
| No tests run against Google Play. Every test uses fake tokens and a temporary datastore | Requires the staging and real-provider verification listed in the final report |

## 7. Cross-provider guard (Stripe, Revolut and Google Play)

A subscription row is billed through exactly one provider (`SubscriptionRecord.provider`). A provider event is the provider
reporting something. It is **not** the member or staff choosing to move the account, so a webhook never infers that consent.

| Existing row | Incoming provider event | Result |
|---|---|---|
| entitled (active, past_due or paused; an `active` row is entitled until its paid-through date, which covers cancelled-but-still-paid) and billed by A | a completion or claim from B | **rejected**: the row, its provider, reference, paid-through date and token are left exactly as they are; a `provider_conflict_rejected` audit event is written; the webhook still answers 200 |
| ended (cancelled, expired, lapsed) or never started (pending) | a completion or claim from another provider | allowed: nothing is being replaced |
| billed by the same provider | its own event | allowed and idempotent (event-id dedupe, period only rolls forward) |
| manual (`provider: "none"`) | a member-initiated web switch | unchanged: not a paid provider |
| any paid provider | an event found **by that provider's own reference** (invoice, status update, cancellation) but the row belongs to a different paid provider | rejected whether or not the row is live (the reference cannot legitimately belong to it) |

- **Where:** `evaluateProviderTransition` and `evaluateReferenceMismatch` in `lib/iap/entitlement-conflict.ts`, called from the Stripe
  webhook (switch completion, fresh completion, invoice, payment failure, subscription deletion), the Revolut webhook, and the
  Play claim and notification paths. The staff, admin and web-checkout paths already share the same module.
- **Stable code:** `other_provider_active`. A Play claim over a live Stripe or Revolut **Membership** still answers
  `membership_active` (the established code); over a live Stripe or Revolut App Subscription it answers `other_provider_active`.
- **Concurrency:** the datastore is one synchronous file in one process. Each guarded handler reads the row, evaluates the rule
  and writes with **no `await` in between**, so a concurrent webhook or claim cannot interleave. Whichever block runs first wins and
  the other sees its result and is refused. The Stripe event id is recorded even for a refusal, so a redelivery is skipped. This is
  the equivalent safe guard for the file-backed datastore (a SQL store would use a row lock or a unique constraint).
- **Pending checkout intent is parked, not lost:** when a Play purchase replaces a *pending* Stripe checkout, the checkout's
  package, option and session move to the `pending*` fields and the Play row's setup-order reference is cleared. A later Stripe
  completion for that session is promoted only if no Play entitlement is live then, and then records `provider: "stripe"` (the
  webhook previously left the old provider name on the row).
- **Audit:** the event stores the account, the incoming and existing provider, the code, the source, and a SHA-256 of the incoming
  reference. No payload text, token or secret.
- **Not automatic:** a refused completion means the member may have paid the refused provider. Nothing is cancelled or refunded
  automatically (D2). Staff find it from the audit event and cancel and refund at that provider by hand.
- **Follow-up, not built:** a deliberate, policy-controlled provider transition (cancel at the old provider, then activate the new
  one with explicit consent). The architecture has no place for it yet, so none is offered. Decision needed from the owner.
