# Tenant platform billing and lockout (complete, 2026-11-25)

Status: **built end to end and tested; switched off.** Nothing is ever locked unless `TENANT_LOCKOUT_ENABLED=true` is set on the server. With the switch off every gym, including S&C, behaves exactly as before.

## What the owner decided (2026-11-18)

- Tenants pay S&C for the platform, like a gym membership.
- A missed payment gets a grace period, then the tenant is **locked out**.
- **Nothing is deleted.** When they pay again, everything comes back at once.
- S&C never holds or moves tenant money. Tenants pay S&C through a payment link S&C hosts; the gym's own members pay the gym through the gym's own providers.

## How it works

**The rule** (`lib/tenant-billing.ts`, pure). A gym can carry `platformBilling: { paidThrough, graceDays?, payUrl?, stripeCustomerId? }`.
`paidThrough` is the last paid day. Active through it, then **grace** for `graceDays` (default 14, per-gym 0 to 60), then **locked**. The last grace day still counts as grace. No `platformBilling` = not billed = never restricted (the primary gym and any gym not yet on a plan). Platform operators are never locked.

**Everywhere the gym's people touch the server** (switch on):

| Surface | What a locked gym gets |
|---|---|
| API, every signed-in route (230) | `423` with `code: "tenant_locked"`. Members: "This gym is temporarily unavailable. Nothing has been lost." Staff: "Your gym's platform subscription is overdue, so access is paused. Nothing has been deleted..." |
| Website `/dashboard` and `/staff` | Redirect to `/gym-unavailable`, a plain page (staff also get a "Pay now" button to the gym's payment link) |
| Mobile app | A full-screen "temporarily unavailable" screen (members), or "Access is paused" with a Pay now button (staff). "Check again" asks the server at once, so access returns the moment the gym has paid. Sign out always works |
| Push notifications | Not sent to a locked gym's people (`lib/push.ts`) |
| Email | Routine email is not sent to a locked gym's people (`lib/email.ts`); sign-in and account-security email (password reset, email change, password changed) still goes (`essential: true`) |
| The scheduled jobs | They still run, but everything they send goes through the two chokepoints above, so a locked gym receives nothing (class reminders, reports, expiry notices, and so on) |

**In grace** (before the lockout) the gym's staff see a banner: "Your gym's platform payment is overdue. Access pauses in N days unless it is paid", with a Pay link, on the website staff area and in the app's staff screens. Members never see it. The session check (`GET /api/mobile/auth/me`) reports `tenant: { state, graceEndsOn, graceDaysLeft, payUrl }` (payUrl only for the gym's staff).

**Routes deliberately still reachable while locked** (each has a written reason in `lib/route-scope-manifest.ts`): `account/delete` (a member can always delete their own account), `mobile/auth/me` (the app needs it to learn the state), `profile/ai-consent`, `profile/email-preferences`, `push/subscribe`, `mobile/push` (a member can always withdraw consent and switch notifications off), `mobile/equipment-catalog`, `mobile/gyms/geocode`, `mobile/gyms/nearby` (no gym data), `mobile/gyms/my-gym/visibility`.

## How a tenant pays and is switched back on

1. Operator opens **`/staff/tenants`** (platform operator only) and, for a gym, records `paidThrough`, optional grace days, the gym's **payment link** (https, S&C-hosted), and the gym's **Stripe customer id** (`cus_...` in S&C's own Stripe account). Same actions are available through `POST /api/staff/gyms/[gymId]/billing`; `GET /api/staff/gyms/billing` lists every gym and its state.
2. The gym pays S&C through the link. S&C's Stripe sends `invoice.paid` to **`POST /api/webhooks/tenant-billing`** (its own signing secret `TENANT_BILLING_WEBHOOK_SECRET`; refuses everything without it). The gym is found by the customer id **stored on the gym**, never from anything in the event. The paid-through date moves to the end of the paid period, never backwards; each event is applied once; unknown events and customers are acknowledged and ignored. Access returns immediately.
3. Or the operator just records a later date by hand.

## Proof

- `__tests__/api/tenant-lockout-routes.test.ts`: for every enforced route, **every** exported handler (GET, POST, PUT, PATCH, DELETE) is called as an account of a locked gym and must answer 423; the same calls from the primary gym and from the same gym once paid must never answer 423; the exempt list is pinned; the manifest flags cannot disagree with the source. It found eight real gaps the first pass missed, all fixed.
- `__tests__/api/tenant-lockout.test.ts`, `__tests__/lib/tenant-billing.test.ts`: the rule, the switch, who is never locked, paying again restoring access.
- `__tests__/api/tenant-billing-platform.test.ts`: the operator list and billing route (validation of the link and customer id), the Stripe webhook (no secret / wrong signature / tampered body refused, invoice moves the date and lifts the lockout, applied once, never backwards, unknown events and customers ignored, a gym cannot be named from inside the event), what the session check reports, and that a locked gym is sent no push or routine email while security email still goes.
- App: `src/lib/__tests__/tenant-status.test.ts` (status parsing, a 423 locking the app, sign-out clearing it).
- Full server suite 4,031 tests pass; app suite 589 pass.

## Switching it on (do this in order)

1. Take a datastore backup and merge #143, then #144 (this stack), then the app branch `feat/tenant-lockout-app`; deploy; confirm nothing changed (switch still off). `/staff/tenants` shows "Lockout is currently OFF".
2. In S&C's Stripe: create the tenant subscription product and payment link; add a webhook endpoint `https://<site>/api/webhooks/tenant-billing` for `invoice.paid`; copy its signing secret into the host as `TENANT_BILLING_WEBHOOK_SECRET`.
3. For each tenant gym: in `/staff/tenants` record its Stripe customer id, payment link and paid-through date.
4. Rehearse on a test gym with a past date: set `TENANT_LOCKOUT_ENABLED=true`, check a member and a staff account see the unavailable screen (app and website), pay a test invoice (Stripe test mode), confirm access returns.
5. Only then switch it on for real. Switching it off again restores everything at once; the lockout changes no data.

## Decisions that are the owner's (defaults are in place, change by editing one value)

1. **Grace length.** Default 14 days (`DEFAULT_TENANT_GRACE_DAYS`), settable per gym.
2. **Staff sign-in while locked.** The gym's staff reach the unavailable page and the pay link only. Routes can opt in to more with `allowWhenLocked`.
3. **Members' own App Subscriptions** (paid to Apple or Google, not the gym) follow the same gate during a lockout.

## Scope note

This covers the platform billing and lockout system. The other parts of the wider multi-tenant plan (per-tenant logo and colours, the tenant's own branded web member area, the sign-up and onboarding flow, and the tenant instruction manual) are separate features that are not part of it.

## Self-serve payment (built 2026-11-25)

A gym's admin pays S&C on the Gym setup page ("Subscribe", then "Pay or renew" and "Manage card, invoices or cancel"), and a locked gym's admin can pay from the gym-unavailable page. It uses S&C's own Stripe account (`lib/tenant-subscription.ts`, route `POST /api/staff/gym/subscription`): the gym's Stripe customer is created once and remembered as `platformBilling.stripeCustomerId`, checkout runs in subscription mode for the one platform price, and the billing portal handles card, invoices and cancellation. The gym is marked paid only by the `invoice.paid` webhook above, never by the page it returns to.

Set up once in Stripe: a Product with one recurring Price (its id in `TENANT_PLATFORM_PRICE_ID`), the Customer Portal switched on, a webhook endpoint for `/api/webhooks/tenant-billing` sending `invoice.paid` (signing secret in `TENANT_BILLING_WEBHOOK_SECRET`). Optional `TENANT_TRIAL_DAYS` (0 to 90, default none). Until the price id is set the page says online payment is not switched on and the manual route above still works.

Starting checkout gives a gym no free time (owner decision 2026-11-25). Its Stripe customer is kept as `pendingStripeCustomerId`; the gym only becomes billed (paid-through date, `firstPaidAt`) when its first invoice is paid. Gyms are approved by hand, so one that starts and walks away is never listed.

**14-day money-back.** In `/staff/tenants` (platform operator only) a gym inside 14 days of its `firstPaidAt` has a "Refund and end access" button. It refunds the latest paid charge in Stripe, cancels the subscription, and sets paid-through to yesterday with no grace. After 14 days the button is disabled (an exception can still be refunded in Stripe by hand). The guarantee needs to be stated in the terms.

## Size-based pricing (built 2026-11-25)

Four bands by member count (members who are not archived): up to 50, 51 to 100, 101 to 149, 150 or more, billed monthly or yearly (`lib/tenant-pricing.ts`). Eight Stripe prices, one per band and interval, are set in `TENANT_PRICES` (JSON: `{"month":{"b50":"price_...","b100":"price_...","b149":"price_...","b150":"price_..."},"year":{same four}}`). A half-filled setting is ignored; without it the single `TENANT_PLATFORM_PRICE_ID` applies to every gym.

- **First payment:** the band comes from the gym's member count at that moment, and the interval (monthly or yearly) from the length of the period the invoice paid for.
- **No gaming the threshold:** the job `tenant-member-high-water` records each billed gym's member count daily and keeps the highest in the current period. At each renewal the NEXT period's band comes from that highest count, not from the count on renewal day, so removing members before month end and adding them back after payment does not lower the band. A new period then starts from the members the gym has at that moment. The band can come down only when a whole period stayed lower.
- **Moving a band:** at renewal the subscription's price is switched to the new band's price with no proration, so it applies from the next invoice. A failed Stripe call keeps the old band and the next renewal tries again.
- **Yearly gyms:** the band is set at each yearly renewal from the year's peak. Growth part-way through a yearly period is picked up at the next renewal, not mid-year.
