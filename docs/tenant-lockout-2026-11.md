# Tenant lockout for an unpaid platform subscription (2026-11-24)

Status: built and tested, **switched off**. Nothing is locked unless `TENANT_LOCKOUT_ENABLED=true` is set on the server. Not deployed to any tenant.

## What the owner decided (2026-11-18)

- Tenants pay S&C for the platform, like a gym membership.
- A missed payment gets a grace period, then the tenant is **locked out**.
- **Nothing is deleted.** When they pay again, everything comes back at once.
- S&C never holds or moves tenant money. This slice only records a date; it takes no payment.

## How it works

- A gym record can carry `platformBilling: { paidThrough: "YYYY-MM-DD", graceDays? }`. `paidThrough` is the last paid day. No `platformBilling` means the gym is not billed and is **never** restricted (the primary gym, and any gym not yet on a plan).
- The rule (`lib/tenant-billing.ts`, pure): active through `paidThrough`, then **grace** for `graceDays` (default 14, a gym can have its own, 0 to 60), then **locked**. The last day of grace still counts as grace.
- The check (`lib/tenant-lockout.ts`) runs where a request becomes a verified tenant context (`lib/tenant-request.ts`: `resolveTenantRequest`, `resolveStaffTenantRequest`, `requireTenantAccess`). A locked tenant gets a `423` with `code: "tenant_locked"`:
  - members: "This gym is temporarily unavailable. Nothing has been lost."
  - the gym's staff: "Your gym's platform subscription is overdue, so access is paused. Nothing has been deleted: it all comes back once the payment is made."
- The primary gym (`gymId` null) and platform operators are never locked, whatever the data says.
- A route can pass `allowWhenLocked: true` so the locked gym's own **staff** (never members) still get through, for the page where they pay.
- `POST /api/staff/gyms/[gymId]/billing` (platform operator only, same rule as the status route, and a gym cannot change its own billing) records `{ paidThrough, graceDays? }`, or `{ paidThrough: null }` to take a gym off billing. Paying again is just a later date, and access returns immediately.

## Where it is enforced (updated 2026-11-25)

**Every signed-in route** except the ten below. That is 230 routes: the staff routes, the gym community routes, and all the member routes. It is checked right after the route's own sign-in (and permission) check, through `requireTenantAccess` / `requireTenantAccessForUserId` or the two resolvers in `lib/tenant-request.ts`, and for the gym community in `gymCommunityAccess` (`lib/community-gym.ts`).

`__tests__/api/tenant-lockout-routes.test.ts` proves it against the real handlers, not a list: for every enforced route, every exported handler (GET, POST, PUT, PATCH, DELETE) is called as an account of a locked gym and must answer 423; the same calls from the primary gym and from the gym once it has paid must never answer 423. The test caught seven handlers and one early return that the first pass had missed, all fixed. The manifest (`lockoutEnforced` / `lockoutExempt`) and the source cannot disagree, and the exempt list is pinned.

**Deliberately still reachable while a gym is locked** (each has a written reason in `lib/route-scope-manifest.ts`):
`account/delete` (a member can always delete their own account), `mobile/auth/me` (the app needs it to learn the gym is locked, instead of signing the member out), `profile/ai-consent`, `profile/email-preferences`, `push/subscribe`, `mobile/push` (a member can always withdraw their own consent and switch notifications off), `mobile/equipment-catalog`, `mobile/gyms/geocode`, `mobile/gyms/nearby` (no gym data), and `mobile/gyms/my-gym/visibility` (a locked gym's staff may still change whether it is listed).

Public routes, webhooks, cron jobs, global shared data and platform-only routes are out of scope: they have no tenant session, or operate across tenants by design. The scheduled jobs (reminders, reports, emails) are platform-wide and are NOT paused for a locked gym yet.

## Still to do before switching it on for a real tenant

- **The apps.** The member and staff apps need a clear "this gym is temporarily unavailable" screen when the server answers 423 with `code: "tenant_locked"`, instead of a generic error. Until then a locked member sees an error on every screen. `mobile/auth/me` stays open so the app can detect the state at start-up (it does not report it yet; adding `tenantAccess` to its answer is the next small step).
- **The jobs.** Stop sending reminders, class emails and reports to a locked gym's members.
- **A grace-period banner** for the gym's staff ("access pauses in N days") and the payment itself (S&C's own Stripe and its webhook marking a tenant paid). Not built.
- **The website** (`/staff`, `/dashboard` pages) uses server components, not these routes, so the web pages are not covered yet either; only the API behind them is.

## Questions for the owner (none blocks the next slice)

1. **Grace length.** Default is 14 days, settable per gym. Is 14 right?
2. **Staff sign-in while locked.** Built so the gym's staff can reach the pay page only (`allowWhenLocked`). Confirm that is what you want, or whether staff should be fully blocked too.
3. **Are members told, and by whom?** Today members see the plain message when they open the app. An email or notice from the gym owner is not built.
4. **Members' own App Subscriptions** (paid to Apple or Google, not the gym) during a lockout: they currently follow the same gate. Should they keep working?

## Switching it on later

Set `TENANT_LOCKOUT_ENABLED=true` on the server, with a backup first and the route conversions done. Switching it off again restores everything, since no data is changed by the lockout.
