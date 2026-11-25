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
- The check (`lib/tenant-lockout.ts`) runs where a request becomes a verified tenant context (`lib/tenant-request.ts`: `resolveTenantRequest` and `resolveStaffTenantRequest`). A locked tenant gets a `423` with `code: "tenant_locked"`:
  - members: "This gym is temporarily unavailable. Nothing has been lost."
  - the gym's staff: "Your gym's platform subscription is overdue, so access is paused. Nothing has been deleted: it all comes back once the payment is made."
- The primary gym (`gymId` null) and platform operators are never locked, whatever the data says.
- A route can pass `allowWhenLocked: true` so the locked gym's own **staff** (never members) still get through, for the page where they pay.
- `POST /api/staff/gyms/[gymId]/billing` (platform operator only, same rule as the status route, and a gym cannot change its own billing) records `{ paidThrough, graceDays? }`, or `{ paidThrough: null }` to take a gym off billing. Paying again is just a later date, and access returns immediately.

## What is NOT enforced yet

Only routes that already use the runtime tenant context are covered: the 12 flagged `runtimeTenantContext: true` in `lib/route-scope-manifest.ts`. The rest are listed in `docs/runtime-tenant-context-adoption-2026-10.md` (50 tenant-staff routes, 18 self-tenant-checked, 116 self). Until each is converted, a locked gym can still use it. **Do not switch the lockout on for a real tenant until the staff and member routes are converted** (next slice), otherwise it only half works.

Also not done: the member app and staff screens showing the "temporarily unavailable" message nicely (they would currently see the plain message from the 423), a grace-period banner for staff ("access pauses in N days"), the platform payment itself (S&C's own Stripe and its webhook marking a tenant paid), and telling members or staff by email.

## Questions for the owner (none blocks the next slice)

1. **Grace length.** Default is 14 days, settable per gym. Is 14 right?
2. **Staff sign-in while locked.** Built so the gym's staff can reach the pay page only (`allowWhenLocked`). Confirm that is what you want, or whether staff should be fully blocked too.
3. **Are members told, and by whom?** Today members see the plain message when they open the app. An email or notice from the gym owner is not built.
4. **Members' own App Subscriptions** (paid to Apple or Google, not the gym) during a lockout: they currently follow the same gate. Should they keep working?

## Switching it on later

Set `TENANT_LOCKOUT_ENABLED=true` on the server, with a backup first and the route conversions done. Switching it off again restores everything, since no data is changed by the lockout.
