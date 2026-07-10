# Payments & entitlements architecture

Production-minded commerce for memberships (recurring) and class pass packs
(one-off), built on Revolut's Merchant API. Extends `docs/billing-revolut.md`
(provider setup) — this doc covers the internal model, flows, and safety
properties.

## Provider: Stripe-first

Stripe is the **primary provider** (`activeBillingProvider()` in
lib/billing.ts picks Stripe when `STRIPE_SECRET_KEY` is set; Revolut remains
a configured fallback). Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
(whsec_), optional `STRIPE_CURRENCY` (default eur), `APP_BASE_URL`.

**Correct Stripe usage implemented:**
- Memberships → Checkout Sessions in `subscription` mode (inline recurring
  price_data). The session id is stored on the subscription row
  (providerSetupOrderId); the real subscription id (sub_…) and customer id
  arrive via `checkout.session.completed` and are attached then.
- Pass packs → Checkout Sessions in `payment` mode. The internal purchase
  id rides as client_reference_id + session metadata + PaymentIntent
  metadata, and doubles as the **Idempotency-Key** (`pass:<purchaseId>`) so
  even a duplicate that slips past the app guard can't create two sessions.
- Webhook `/api/stripe/webhook`: Stripe-Signature verified (HMAC over
  `t.body`, 5-min tolerance). Event ids (evt_…) are the dedupe key —
  Stripe retries reuse the id, so replays acknowledge and skip.
- Delayed payment methods: sessions completing with `payment_status !==
  "paid"` are not credited; `async_payment_succeeded` credits,
  `async_payment_failed` marks failed, `expired` marks cancelled.
- Refunds: `charge.refunded` correlates via the stored PaymentIntent
  (providerPaymentRef) with metadata fallback → `paid → refunded` + one
  compensating ledger entry.
- Subscription lifecycle: `invoice.payment_failed` → past_due,
  `customer.subscription.deleted` → canceled; period lapse remains computed
  live so access never outlives payment.

Register these webhook events in the Stripe dashboard:
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`,
`charge.refunded`, `invoice.payment_failed`,
`customer.subscription.deleted`.

## Pass consumption (implemented)

Purchased passes are a separate pool from the plan's monthly allowance:
- Booking with allowance exhausted + positive pack balance → booking is
  created and ONE `consume` ledger entry is written, keyed to the booking
  id (the monthly counter is untouched). No balance → honest 403.
- Early cancellation (existing cutoff rule) returns whichever pool paid:
  ledger `consume_reversal` (once, only if consumed) or the counter
  decrement as before. Late cancellation keeps either consumed.
- Waitlist offer acceptance uses the same coverage logic, and offer
  eligibility counts pack balances so members with packs aren't skipped.
- Member view: "Pass packs" shown separately in the Membership class-pass
  panel. Staff view: pack balance + recent ledger in the member editor.

## Layering

```
UI / API routes
   │  (never provider-specific)
lib/payments.ts      ← purchase lifecycle, entitlement appliers, idempotency
lib/billing.ts       ← provider-neutral checkout surface
lib/providers/*      ← Revolut REST calls + webhook signature verification
```

Secrets (`REVOLUT_SECRET_KEY`, `REVOLUT_WEBHOOK_SIGNING_SECRET`) live only in
env and are only read inside `lib/providers/*`.

## Internal model (lib/db.ts)

| Record | Role |
|---|---|
| `MembershipPlanRecord` | Recurring products (existing). |
| `ClassPassProductRecord` | One-off pass packs: `passCount`, `priceCents`, `isActive`. |
| `PurchaseRecord` | Internal order spine: one row per checkout attempt. `status: pending → paid \| failed \| cancelled; paid → refunded`. Holds `providerOrderId`, `checkoutUrl`, `idempotencyKey`. |
| `SubscriptionRecord` | Membership entitlement state (existing, webhook-driven). |
| `PaymentEventRecord` | Webhook dedupe/audit ledger, keyed `EVENT:entityId`. |
| `PassLedgerEntryRecord` | Append-only pass entitlement ledger. Balance = Σ delta. Reasons: `purchase`, `refund_reversal`, `consume`, `staff_adjust`. |

**Source-of-truth rules**
- Provider state is never read to decide access. Webhooks flip OUR records;
  entitlements derive from OUR records.
- Redirect/success pages grant nothing — they only display status.
- Ledger entries are never mutated; corrections are compensating entries.
- Provider IDs are stored as linkage (`providerOrderId`,
  `providerSubscriptionId`) but entitlement records are separate rows.

## Flows

### Buying a membership (existing, unchanged)
1. Member selects a plan → `POST /api/membership/select` creates a Revolut
   subscription checkout, stores subscription as `pending`.
2. Member pays on the hosted page. The redirect back shows "awaiting
   payment" — no access yet.
3. Signed webhook (`ORDER_COMPLETED`/`SUBSCRIPTION_*`) is the only path to
   `active`. Fresh periods reset `sessionsUsedThisPeriod` + staff grants.

### Renewal / cancellation / failure (existing)
- `SUBSCRIPTION_OVERDUE` → `past_due`; `SUBSCRIPTION_CANCELLED`/`FINISHED` →
  `canceled`; period lapse is computed live (`isPeriodLapsed`) so access
  never outlives a paid period even if a webhook is missed.
- Out-of-order deliveries can't regress status (`lastWebhookEventAt` guard).

### Buying a class pass pack (new)
1. `POST /api/passes/checkout` `{ productId, idempotencyKey }` (member auth).
2. Duplicate-submit protection: key is scoped `userId:key` (fallback
   `userId:productId`). A fresh `pending` purchase under that key returns the
   SAME `checkoutUrl` — no second provider order. Stale (>30 min) pending
   purchases are retired (key suffixed) and a fresh attempt begins.
3. A `PurchaseRecord` (`pending`) is created FIRST; the Revolut order carries
   `merchant_order_ext_ref = purchase.id` for reconciliation; provider ids
   are attached after creation. Provider failure → purchase `failed`, 502.
4. Webhook `ORDER_COMPLETED`:
   - event key `ORDER_COMPLETED:orderId` checked against `PaymentEventRecord`
     — replays/retries are acknowledged (200) and skipped;
   - `pending → paid` via the state machine (an illegal transition, e.g.
     after refund, applies nothing);
   - `applyPaidPassPurchase` credits the ledger **exactly once per purchase
     id** (second call finds the credit and no-ops) — double protection on
     top of event dedupe.
5. `ORDER_FAILED`/`ORDER_PAYMENT_DECLINED` → `failed`; `ORDER_CANCELLED` →
   `cancelled` (member can simply start a new checkout).

### Refunds (pass packs)
`ORDER_REFUNDED` → `paid → refunded` + one compensating ledger entry
(negated credit). If passes were already consumed the balance goes negative —
a true statement of account surfaced to staff, not an error. Membership
refunds remain a staff action (status override) pending provider-side refund
events being wired.

### Why double idempotency
Webhook retries are deduped by event key; but a *different* event carrying
the same consequence (or a manual replay tool) still can't double-credit,
because the credit itself is keyed to the purchase id in the ledger.

## Registered webhook events

Add `ORDER_REFUNDED` to the events listed in `docs/billing-revolut.md`.

## Test plan (implemented ✅ / manual ◻)

- ✅ Purchase state machine legal/illegal transitions (`payments.test.ts`)
- ✅ Ledger credit exactly once per purchase; refund reversal once, only
  after credit; negative balances allowed (`payments.test.ts`)
- ✅ Checkout: 401 unauthenticated; 400/404 bad product; 503 unconfigured
  (nothing created); duplicate submit reuses checkout (no provider call);
  provider failure marks purchase failed; stale pending doesn't block
  (`passes-checkout.test.ts`)
- ✅ Webhook: completed → paid + credited once; replay acknowledged and not
  re-applied; completed-after-refund applies nothing; declined/cancelled
  transitions; refund writes compensating entry; non-purchase orders fall
  through to the subscription path (`billing-webhook-passes.test.ts`)
- ✅ Membership activation only via webhook (existing suite)
- ✅ Existing 34-file suite still green (booking, entitlement, AI, etc.)
- ✅ Visual regression: 6 baselines unchanged (`npm run test:visual`)
- ◻ Sandbox end-to-end: real Revolut sandbox checkout → webhook → passes
  credited (needs `REVOLUT_SECRET_KEY`/`REVOLUT_WEBHOOK_SIGNING_SECRET`)
- ◻ Contrast audit of smallest text on brightest glass (separate follow-up,
  unchanged from the v7 lockdown report)

## Remaining next steps (in order)

1. **Consumption wiring**: extend `classPassBalance`/`remainingSessions` so
   purchased passes are spendable on bookings once the plan allowance is
   exhausted (`consume` ledger entries on booking, reversal on early
   cancel), then surface "purchased passes" in the Membership panel and the
   staff member view.
2. **Buy-passes UI**: product list + buy button on Membership (uses
   `/api/passes/checkout`), pending/paid purchase status list.
3. **Staff product management**: CRUD for `ClassPassProductRecord`
   (append-only pricing history preferred over edits).
4. **Migrate membership checkout onto `PurchaseRecord`** so recurring and
   one-off purchases share one auditable spine (currently membership state
   lives on the subscription row only).
5. **Sandbox run-through** + register `ORDER_REFUNDED` webhook; then key
   rotation and spend caps from the pre-launch checklist.
