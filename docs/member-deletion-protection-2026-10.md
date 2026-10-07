# Hard deletion and Google Play subscriptions (2026-10-07)

**Status:** implemented and tested with a fake provider and a temporary datastore. Not exercised against Google.
Closes the post-merge audit finding that deleting a member could remove their purchase record while the Google Play
subscription was still being billed.

## The problem

A Google Play subscription is billed by Google and can only be cancelled by the member in Google Play. Permanently deleting the
member's account used to delete their `googlePlayPurchases` rows. If the subscription was still running, Google kept billing,
later notifications found no owner and were ignored, and the paid entitlement was untracked. It also freed the purchase token.

## Behaviour now

| Member's Google Play state | Hard delete |
|---|---|
| `active` | **refused** |
| `past_due` (grace period) | **refused** |
| `paused` | **refused** |
| cancelled in Google Play but still inside the paid period | **refused** (access continues to the paid expiry) |
| expired, on hold, cancelled with the paid period passed, revoked or refunded | allowed; purchase records are **anonymised**, not deleted |
| never bought | allowed, as before |

- **Refusal:** `POST /api/staff/members/[userId]/delete` answers `409` with `{ success: false, code: "active_subscription", message }`.
  The message is fixed and contains no token, order id, date, member id or provider text. The existing preconditions still run
  first (admin_manager only, member accounts only, archived first, same gym).
- **Nothing changes on a refusal:** the account, the purchase record and its token binding, the subscription row and every earlier
  audit event are untouched. **Nothing is cancelled, refunded or sent to Google.**
- **Audit:** each refused attempt writes one `staff_write_rejected` event with `code: "active_subscription"`,
  `source: "member_hard_delete"` and the protected state word (for example `active` or `canceled_until_expiry`), never a token. Repeated
  attempts are refused identically and each leaves one event, because each is a separate staff action.
- **Where it is enforced:** inside `deleteUserAndOwnedRecords` in `lib/db.ts` (it throws `MemberDeletionRefused` before changing
  anything), so no caller can bypass it, and again in both maintenance scripts. The route turns the error into the 409.
- **Both sources are checked:** the member's purchase records and their subscription row. A subscription row that still shows a running Play
  entitlement protects the member even if the purchase record is missing.

## Anonymisation instead of deletion (ended entitlements)

When deletion proceeds, each of the member's purchase records keeps its token, hash, order, status and dates but its owner becomes an
opaque `deleted:<16 hex>` id (derived by a one-way hash) and `anonymizedAt` is set. This honours "preserve historical purchase records" while
no longer naming the member.

- **The token stays owned.** No other account can claim it, even with a valid binding of its own (`owned_by_other`).
- **A late notification cannot resurrect anything.** It is recorded on the purchase and audited as `notification_stale` with reason `owner_deleted`,
  and **no subscription row is ever created for a deleted account**. Reconciliation and acknowledgement retry skip anonymised records.
- Audit events (`iapEvents`) are never deleted by member deletion.

This is a choice made to satisfy the stated default ("preserve historical purchase and audit records"). It changes what hard deletion removes
for ended Play purchases (they are now kept in anonymised form). If counsel or the owner decides that anonymised purchase records must also be
erased, that is a one-line change plus a retention policy, and it should be made deliberately.

## Not covered, and why

- **Stripe and Revolut subscriptions** are not protected by this guard. The task and the defect were about Google Play. What should happen when a
  member with a live Stripe or Revolut subscription is deleted is part of owner decision 6 and is **not decided here**.
- **`on_hold`** is treated as ended (access is already removed). If Google recovers the subscription later, the token is still owned by the anonymised record
  but there is no account to entitle. Revisit if on-hold subscriptions should also block.
- **Account deletion requested by the member** (as opposed to staff hard delete) has no route today. When one is added it must call the same guard.
- **Retention of `iapEvents`** is a separate follow-up (see `docs/iap-low-severity-hardening-2026-10.md`).

## Maintenance scripts

`scripts/delete-members.mjs` and `scripts/delete-non-staff.mjs` mirror the same rules: a member with a running Play entitlement is listed as
**refused** and skipped, ended members are deleted with their purchase records anonymised, and the output never prints a token or id. They remain
tools for seed and test accounts, never for real member data.
