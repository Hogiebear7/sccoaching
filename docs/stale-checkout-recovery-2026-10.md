# Stale Stripe checkout recovery (2026-10)

Closes **MEDIUM 3** from the post-merge audit.

## The problem

A Stripe Checkout session stays payable for up to 24 hours. This app treats a pending checkout as stale after 30 minutes
(`PENDING_CHECKOUT_STALE_AFTER_MS` in `lib/billing.ts`). Two paths then threw the checkout reference away:

1. `expire-stale-checkouts` **cleared** the pending switch fields of a stale switch.
2. A Google Play claim that took over a row dropped the row's Stripe setup-order reference.

A member who paid late was charged by Stripe while the webhook matched no row. That payment needed manual recovery and
nothing recorded that it had happened.

## Policy now: park, never discard

A stale or displaced checkout is moved into `SubscriptionRecord.abandonedCheckouts` (`lib/checkout-recovery.ts`). Each entry holds
the provider session id, package, billing option, start and clear times, and a reason (`stale_switch`, `stale_pending`,
`replaced_by_play`). Entries are:

- **Idempotent**: one entry per session id; repeating the cleanup or the takeover changes nothing.
- **Bounded**: at most `MAX_ABANDONED_CHECKOUTS` (10) per row, newest kept.
- **Never deleted** by cleanup. A completed late payment marks its entry `settledAt` (kept for history).

Where each case parks:

| Situation | What happens |
| --- | --- |
| Stale **switch** on an active Stripe plan | Cleanup parks the switch (`stale_switch`). The live plan is untouched. |
| Stale never-paid **pending** checkout | Unchanged: the row goes `inactive` and keeps its setup-order id, so a late payment still activates it. |
| Play claim over a **pending** Stripe checkout | The checkout moves to the pending-switch fields (as before). Cleanup later parks it (`replaced_by_play`). |
| Play claim over a cleanup-flipped (`inactive`) Stripe row | The setup-order reference is parked (`replaced_by_play`) instead of dropped. |

## A late completion

`checkout.session.completed` for a session that matches no pending or setup-order row is looked up in `abandonedCheckouts`. It is then
treated as an on-time switch, through the **same provider guard** (`evaluateProviderTransition`):

- **No other provider holds a live entitlement** → applied: the row becomes an active Stripe plan on the parked package, the entry is
  settled, and a `late_checkout_recovery` audit event with `outcome: "applied"` is written.
- **Another provider holds a live entitlement (for example Play, active / past_due / paused / cancelled but still paid through)** →
  **refused**: the row, Play token binding and paid-through date are untouched, a `provider_conflict_rejected` event and a
  `late_checkout_recovery` event with `outcome: "conflict_manual_recovery"` are written, and the entry stays **unsettled**. The webhook
  still answers HTTP 200 so Stripe does not retry forever.
- A duplicate completion (same or different event id) after a successful recovery finds nothing left to redo.
- An unknown session id matches nothing, exactly as before.

Audit events never carry the session id, the incoming subscription reference, customer id or any payload.

## What is NOT automatic

- **No refund and no cancellation** is ever issued by this code. A late payment refused because Play is live has been charged by Stripe
  and needs a **staff decision** (refund at Stripe, or let it stand). The `conflict_manual_recovery` audit event and the unsettled parked
  entry are the worklist.
- A recovered late switch behaves like any on-time switch, including the existing best-effort cancel of the member's **own previous Stripe
  subscription** (a Stripe-to-Stripe switch). It never touches another provider's subscription.
- No provider transfer or revenue-recognition policy is decided here (owner decisions remain open).

## SQL / multi-process note

The datastore is one synchronous process, so the check-and-write in the webhook is atomic. A multi-process or SQL backend needs a
transaction with a row lock (or compare-and-set on the subscription row) around the lookup and write, plus a unique constraint on
`(provider, session id)` for parked checkouts and transactional webhook event dedupe.

## Tests

`__tests__/api/stale-checkout-recovery.test.ts` (real Stripe webhook route, real cleanup job, real Play service, real temporary datastore,
fake Play adapter, throwaway webhook secret): cleanup before payment, idempotent cleanup, fresh switch untouched, bounded list, late
completion applied, duplicate completion, same event id twice, on-time payment unchanged, inactive pending checkout still activating, no
network, Play takeover then late payment refused (row, token, paid-through preserved; audit; unsettled), no secrets in audit, late payment
applied once Play ended, takeover of an inactive Stripe row parks the reference, repeated refused deliveries, unknown session.
