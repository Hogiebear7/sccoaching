# Membership switching (billing-safe plan changes)

How a member changes from one recurring membership option to another (e.g.
monthly → annual, or a different package) without double-billing, losing access,
or ending up with two live subscriptions.

**Guiding rule:** the member's *active* subscription record is never mutated on a
Switch click. The pending change lives only in `pending*` fields until payment is
confirmed by the webhook. Only then is it promoted and the old provider
subscription cancelled.

## Business rule (developer / admin note)

This is the exact policy the code implements — quote it in support/admin replies:

1. **Switching starts a fresh paid period on the new option after successful
   payment.** The new option is billed in full at that point; there is no
   proration of the new option's first period.
2. **The old membership stays fully active until the new payment succeeds.** If
   the member never completes checkout, nothing changes — they remain on their
   current option and keep their access and usage.
3. **Unused time on the current period is not refunded or credited.** The member
   forfeits whatever time is left on the option they're leaving; the new period
   starts fresh (usage counter reset to 0).

Same-package cadence changes (e.g. monthly → annual) follow the identical rule —
no mid-cycle proration either way. Downgrades and upgrades are treated the same:
pay for the new option now, fresh period, no credit for the old.

## Data model

`SubscriptionRecord` (single row per user) carries the in-flight switch:

| field | meaning |
|---|---|
| `packageId` / `billingOptionId` / `status` / `providerSubscriptionId` / `currentPeriodEnd` | the **active** membership — untouched during a switch |
| `pendingPackageId` / `pendingBillingOptionId` | the target the member is switching to |
| `pendingSetupOrderId` | Stripe Checkout session id of the in-flight switch; the webhook finds the switch by this |
| `pendingStartedAt` | when the switch checkout began, for abandon/staleness cleanup |

## Lifecycle / state transitions

1. **User clicks Switch** — `POST /api/membership/checkout` with the target
   billing option. The member is `active` on a *different* option, so the route
   takes the switch branch. It stages `pendingPackageId` / `pendingBillingOptionId`
   / `pendingStartedAt` and leaves every active field intact. Access is unchanged.
   - Re-buying the *exact* active option → `409` ("already on this membership").
   - A fresh switch to the *same* target already in flight
     (`pendingBillingOptionId` matches, `pendingSetupOrderId` set, not stale) →
     `409`, no second Stripe checkout. (Duplicate-click / retry guard.)

2. **Checkout is created** — the route calls `createCatalogCheckout` for the new
   option (a second, independent Stripe subscription checkout). On success it
   writes `pendingSetupOrderId = session.id` and returns the checkout URL. If
   checkout creation **fails**, the staged `pending*` fields are rolled back to
   `null` and the member is left cleanly on their current membership (`502`).

3. **Payment succeeds** — Stripe creates the *new* subscription and fires
   `checkout.session.completed` (mode `subscription`). The old subscription is
   still live at this instant; both briefly exist, which is expected and resolved
   in step 6.

4. **Webhook arrives** — `POST /api/stripe/webhook` verifies the signature,
   dedupes by event id, then looks up the switch via
   `findSubscriptionByPendingSetupOrderId(sessionId)`. Found → switch-promotion
   path (below). Not found → falls through to the normal fresh-activation path.

5. **Pending switch becomes active** — the record is promoted in one write:
   `packageId`/`billingOptionId` ← the `pending*` values; `status = "active"`;
   `providerSubscriptionId` ← the new Stripe sub id; a **fresh period** on the new
   option (`sessionsUsedThisPeriod = 0`, `extraSessionGrants = []`, new
   `currentPeriodEnd`); and all `pending*` fields cleared. No proration — the
   member keeps the time already paid on the old option and simply starts fresh on
   the new one.

6. **Old subscription ended/replaced** — after promotion (record now points at the
   new sub id), the webhook best-effort cancels the *previous* provider
   subscription (`cancelProviderSubscription`) so it cannot keep billing. Cancel is
   idempotent (treats already-cancelled / not-found as success) and non-blocking:
   the new membership is already active, so a cancel failure only logs a
   staff-reconcile warning — it never rolls back the promotion. Because the record
   already points at the new sub, a later `customer.subscription.deleted` for the
   old sub matches no record and is a safe no-op.

7. **Failed or abandoned checkout cleanup** — if the member never completes the
   new checkout, the webhook in step 4 never fires, so the `pending*` fields just
   sit alongside the still-active old membership (access never affected). The
   `expire-stale-checkouts` job clears any subscription whose `pendingSetupOrderId`
   is set and whose `pendingStartedAt` is past the retry window, nulling the four
   `pending*` fields without touching the active membership. The member stays
   exactly on their current plan.

## Safety properties

- **No double-billing:** the old provider subscription is cancelled the moment the
  new one is confirmed active (step 6). The same cancel-on-replace guard also
  covers the fresh-activation path (e.g. a past-due member starting a new sub).
- **No lost access:** active fields are never mutated until confirmed payment;
  an abandoned or failed switch leaves the member on their current membership.
- **No duplicate active subscriptions:** one row per user; promotion overwrites the
  single active pointer and cancels the previous provider sub.
- **Idempotent under webhook retries:** promotion is a single deterministic write;
  the cancel treats already-cancelled/not-found as success.
- **No proration for same-package cadence switches:** the new option starts a fresh
  period; the current paid period is neither prorated nor refunded (communicated in
  the member UI on the Switch control).

## Legacy fallback

Legacy plan-based subscriptions (`planId` set, no `packageId`) are handled
conservatively: entitlement still resolves through
`resolveSubscriptionEntitlement`, and a switch from a legacy sub simply stages the
new catalog option in `pending*` like any other — the legacy active fields are left
untouched until confirmation.

## Verifying the switch lifecycle

### Automated coverage

- `__tests__/api/stripe-webhook.test.ts` — switch promotion, fresh period, old-sub
  cancel handoff.
- `__tests__/api/membership-checkout.test.ts` — non-clobbering staging, dup-switch
  409, rollback on failed checkout creation.
- `__tests__/lib/jobs.test.ts` — abandoned-switch cleanup.

### Record-level smoke harness (test-mode, no real money)

`npm run smoke:switch` (`scripts/smoke-switch-lifecycle.mjs`) runs against a
**running dev server** and exercises the promotion end-to-end with a **real signed
webhook** (the same HMAC scheme the server verifies). It:

1. seeds a throwaway subscription that is active on one option with a switch
   **staged** in `pending*` (the state right after checkout creation);
2. delivers a signed `checkout.session.completed`;
3. asserts the record was promoted to the new option, started a fresh period,
   points at the new provider subscription, dropped the old one, cleared every
   `pending*` field, and that **exactly one** subscription row remains for the
   member (no duplicate active subscription);
4. removes the throwaway row on exit (safe to re-run; real data untouched).

It reads `STRIPE_WEBHOOK_SECRET` from `.env.local` to sign and never prints it. It
does **not** move real money or create real Stripe objects — in test mode the
previous-subscription cancel resolves against a non-existent id (idempotent
"not found" → success).

### Manual test-mode checklist (the real-Stripe portions)

Do this once against Stripe **test mode** before launch — it covers the parts the
harness deliberately stubs (real checkout + real cancellation):

- [ ] **Switch checkout creation** — as a member already active on option A, click
      **Switch** to option B. Confirm you're redirected to a Stripe Checkout for B,
      and that in the app your membership still shows option A as current (staged,
      not clobbered).
- [ ] **Successful payment** — complete checkout with a test card (`4242 4242 4242
      4242`). Confirm redirect back to the membership page.
- [ ] **Promotion of the pending switch** — confirm the membership now shows option
      B as current, with a fresh period (usage reset), and no `pending*` remnants.
- [ ] **Cancellation of the previous subscription** — in the Stripe **dashboard →
      Subscriptions**, confirm the *old* subscription (option A) is now `Canceled`
      and the *new* one (option B) is `Active`.
- [ ] **No duplicate active subscriptions** — confirm exactly **one** active
      subscription remains for that customer in Stripe, and one row for the member
      in the app.
- [ ] **Abandoned switch** — start a switch but abandon the Stripe Checkout. Confirm
      the member stays on option A. After the retry window, run the
      `expire-stale-checkouts` job (sign in as staff → **Run housekeeping now** on
      `/staff/operations`, or `POST /api/cron/run`; see `docs/scheduler.md`). Confirm
      it clears the `pending*` fields and the member is still cleanly on option A.
