# Revolut billing setup

This app's membership billing is built against Revolut's Merchant API. It is
provider-ready but **not configured** in this environment — no
`REVOLUT_SECRET_KEY` exists, so `isBillingProviderConfigured()` returns
`false` and selecting a plan only records intent (no charge occurs).

## Architecture

- `lib/billing.ts` — provider-neutral surface. App code only imports from
  here.
- `lib/providers/revolut.ts` — Revolut order/checkout creation (REST calls
  via `fetch`, no SDK dependency).
- `lib/providers/revolut-webhook.ts` — webhook signature verification and
  event-to-status mapping.
- `app/api/billing/webhook/route.ts` — receives Revolut webhook events and
  is the only thing allowed to mark a subscription `"active"`.

To switch providers later, only `lib/billing.ts` and a new
`lib/providers/<provider>.ts` need to change — API routes and UI never touch
provider-specific fields.

### Live-readiness hardening already in place

- **Configuration is checked in two parts.** `getBillingConfigurationStatus()`
  in `lib/billing.ts` reports `checkoutConfigured` and `webhookConfigured`
  separately. If only the secret key is set (checkout works) but the webhook
  signing secret isn't, the staff Plans page shows an explicit "billing is
  half-configured" warning instead of members silently getting stuck on
  "Awaiting payment" forever.
- **Abandoned checkouts expire.** A `"pending"` subscription older than
  `PENDING_CHECKOUT_STALE_AFTER_MS` (30 minutes) is treated as abandoned —
  the member can retry rather than being locked out forever because a
  webhook never arrived.
- **Out-of-order webhook delivery is handled.** Revolut explicitly doesn't
  guarantee delivery order. Each subscription tracks
  `lastWebhookEventAt`; an incoming event older than what's already applied
  is acknowledged (200, so Revolut doesn't retry) but not applied, so a
  late-arriving stale event can't regress a more current status.
- **Webhook rejections are logged** (`console.warn`) for invalid signatures,
  stale timestamps, malformed payloads, and unmatched orders — useful when
  debugging a real webhook integration.
- **Currency is validated** before every order request; a malformed
  `REVOLUT_CURRENCY` fails the checkout attempt with a clear error instead
  of sending Revolut a bad value.

## What's needed to go live

1. **Revolut Business account** with Merchant API access (sandbox is free to
   set up for testing).
2. **API keys** — generate a Secret key from the Revolut Business dashboard
   and set `REVOLUT_SECRET_KEY` in `.env.local`.
3. **Webhook** — register a webhook URL pointing at
   `https://<your-domain>/api/billing/webhook` for at least these events:
   `ORDER_COMPLETED`, `ORDER_AUTHORISED`, `ORDER_CANCELLED`, `ORDER_FAILED`,
   `ORDER_PAYMENT_DECLINED`, `SUBSCRIPTION_INITIATED`, `SUBSCRIPTION_OVERDUE`,
   `SUBSCRIPTION_CANCELLED`, `SUBSCRIPTION_FINISHED`. Revolut returns a signing
   secret (`wsk_...`) when the webhook is created — set that as
   `REVOLUT_WEBHOOK_SIGNING_SECRET`.
4. **Environment** — set `REVOLUT_ENV=sandbox` while testing,
   `REVOLUT_ENV=production` to go live. `REVOLUT_API_VERSION` defaults to
   `2024-09-01`; bump it if Revolut ships a newer version you need.
5. **Currency** — plan pricing is EUR throughout the app;
   `REVOLUT_CURRENCY` defaults to `EUR` to match. Membership plans don't
   store a per-plan currency; if you sell in multiple currencies, add a
   `currency` field to `MembershipPlanRecord`.
6. **Local webhook testing** — Revolut needs a publicly reachable URL.
   Use a tunnel (e.g. `ngrok http 3000`) and register the tunnel URL as the
   webhook endpoint while testing in sandbox.

## Recurring subscription flow

The app uses Revolut's Customers + Subscriptions APIs for recurring billing:

1. **Customer creation** — `createRevolutCustomer()` (`POST /api/1.0/customers`)
   creates (or reuses) a Revolut Customer record tied to the member's email.
   The customer ID is stored in `providerCustomerId` on the subscription record
   so it's reused on future checkouts, avoiding duplicates.

2. **Subscription creation** — `createRevolutSubscription()` (`POST /api/1.0/subscriptions`)
   creates a recurring subscription linked to the customer. Revolut returns a
   `setup_order_id`; the member is redirected to that setup order's hosted
   `checkout_url` to complete the first payment, which also saves their payment
   method for auto-renewal. The Revolut subscription ID is stored in
   `providerSubscriptionId`; the setup order ID is stored separately in
   `providerSetupOrderId`.

3. **Webhook activation** — after the member pays, Revolut fires
   `SUBSCRIPTION_INITIATED`. The webhook handler looks up the subscription by
   `providerSubscriptionId` (the Revolut subscription ID) and marks it active.
   Subsequent periods fire `SUBSCRIPTION_INITIATED` again (resetting
   `sessionsUsedThisPeriod` and `currentPeriodEnd`). Overdue charges fire
   `SUBSCRIPTION_OVERDUE` → `past_due`; cancellations fire
   `SUBSCRIPTION_CANCELLED` or `SUBSCRIPTION_FINISHED` → `canceled`.

### Sandbox verification checklist

Before going live, verify in the Revolut sandbox:

- `POST /api/1.0/subscriptions` accepts `customer_id`, `currency`, `amount`,
  and `billing_period: { unit: "MONTH", count: N }`. If the field names differ,
  update `createRevolutSubscription()` in `lib/providers/revolut.ts`.
- The subscription response includes `id` and either `setup_order_id` or
  `checkout_url` directly. The code handles both; check which Revolut returns.
- The setup order's hosted `checkout_url` saves the member's payment method as
  part of subscription setup (without the Checkout Widget). Confirmed if
  `SUBSCRIPTION_INITIATED` fires after payment. If it doesn't, the Checkout
  Widget frontend integration may be required instead.
- `SUBSCRIPTION_INITIATED` carries the subscription ID in `order_id` or
  `subscription_id`. The webhook handler accepts both fields.
- Multi-signature webhook headers (`v1=sig1,v1=sig2`) during key rotation are
  accepted — `verifyRevolutSignature` checks each signature independently.

## Staff manual override

Staff can manually set a member's subscription status from the member
detail page (`/staff/members/[userId]`) — useful for cash payments, comps,
or correcting a stuck state. A manual override always uses
`provider: "none"`; once a member has a real Revolut-backed subscription,
the webhook remains the source of truth for status changes going forward.
