# Runtime tenant context: adoption status (2026-10-07)

**Status:** partially adopted. **This is not a full migration.** Seven routes derive their tenant through
`lib/tenant-request.ts` at runtime. The other 221 routes still rely on the existing `sameGym` family of checks, which are
tested route by route but are not funnelled through one boundary.

This corrects `docs/tenant-context-and-authorization-2026-10.md`, which said the new Google Play routes "are written
against the helpers from the start". At the time of the audit they were not: they called `verifyRequestSession` directly, and
no production route used the helpers at all. The helpers were exercised only by their own tests and by the drift guards.

## What "runtime tenant context" means here

The route's first act is `resolveTenantRequest(request, { unauthenticatedMessage? })`, which turns the signed session into a
frozen `TenantContext` (user id, role, gym id, operator flag). A target account named by the client is then loaded with
`loadTenantUser(ctx, id)`, which returns the same `undefined` for a missing account and for another gym's account, so the
route's one 404 never confirms that a guessed id exists elsewhere.

- A gym id, tenant id or header sent by the client is never read. It is not an input to the helper.
- A route keeps its **own** 401 wording through `unauthenticatedMessage`, so adopting the helper changed nothing a client sees.
  The existing route tests pass unchanged.
- The existing `sameGym` checks were **kept** beside the helper (defence in depth) until the replacement is proven in
  production. The mutation check in this PR shows why: with enforcement in the helper deliberately broken, the runtime tests fail
  while the routes are still protected by `sameGym`.
- A platform operator gets no cross-gym reach through the helper. Platform-only actions stay exact-role capabilities.

## Routes converted (7)

<!-- converted:start -->
| Route | Scope | What the helper does there |
|---|---|---|
| `mobile/billing/google-play/purchase-context` | self | derives the account for the binding |
| `mobile/billing/google-play/verify` | self | derives the account for the claim; a client user id is never read |
| `staff/members/[userId]/tier` | tenant-staff | session, then `loadTenantUser` for the target |
| `staff/members/bulk-tier` | tenant-staff | session, then `loadTenantUser` for every target |
| `staff/members/[userId]/subscription` | tenant-staff | session, then `loadTenantUser` for the target |
| `admin/membership/activate` | tenant-staff | session, then `loadTenantUser` for the target |
| `membership/checkout` | self-tenant-checked | session, then `inTenant` for the catalogue ownership check |
<!-- converted:end -->

`__tests__/api/runtime-tenant-context.test.ts` proves, with the real handlers and a real temporary datastore, that the helper is
**called** (spied, original behaviour intact) with the authenticated account's tenant, and that its answer is **enforced**
(client selectors ignored, cross-tenant equals missing, operator gets no reach, archived or anonymous callers get the route's own
401 and the target is never loaded). `__tests__/lib/route-scope-manifest.test.ts` now fails if a route's
`runtimeTenantContext` flag and its source disagree.

## Not converted, and why

| Scope | Remaining routes | Reason |
|---|---|---|
| tenant-staff | 50 | not yet migrated: `ai/coach-summary`, `ai/draft-reply`, `mobile/staff/*` (13), `staff/attendance/*`, `staff/bookings/*`, `staff/bug-reports/*`, `staff/catalog/*` (6), `staff/categories*`, `staff/classes*`, `staff/community/*`, `staff/invites*`, `staff/members/*` except the three above (ai-usage, archive, delete, extra-sessions, pause, notes, reset-password, update), `staff/messages/unread-count`, `staff/staff-users*`, `staff/workout-templates*` |
| self-tenant-checked | 18 | `bookings/*` (4), `invites/redeem`, `messages/send`, `mobile/community/*` (10), `recovery/log` |
| self | 116 | act only on the session user's own records; mechanical to migrate; every one already uses `verifyRequestSession` |
| own-tenant | 1 | `mobile/gyms/my-gym/visibility` |
| platform | 4 | exact-role platform operator: `staff/finance/ledger*`, `staff/gyms/[gymId]/status`, `staff/settings/finance` |
| global-shared | 16 | intentionally global (exercise library, food catalogue, two singleton settings); no tenant to derive |
| public, webhook, cron | 16 | no session. Webhooks derive the tenant from stored records, never the payload. Background jobs are platform-wide by design |

`staff/members/[userId]/delete` and `staff/members/[userId]/pause` are deliberately left for the pull requests that change them
(deletion protection, Play pause guard) so the two changes do not collide. Convert them next.

## How to migrate a route

1. Replace `verifyRequestSession` plus `findUserById` with `resolveTenantRequest(request, { unauthenticatedMessage })`.
2. Replace `findUserById(targetId)` plus `sameGym(...)` with `loadTenantUser(ctx, targetId)`. Keep the `sameGym` line until the
   route's existing isolation test has been run against the new code.
3. Set `runtimeTenantContext: true` on the route's manifest entry. The manifest test fails if the flag and the source disagree.
4. Add the route to the converted list in this document. The runtime test checks the flagged list.

## Not done

- No ORM-level or datastore-level tenant filter exists. The datastore is one JSON file, so enforcement is application-layer.
- Webhooks, jobs, exports and reports are not tenant-contextual because they are platform-wide or derive the tenant from stored
  records. That is documented in `docs/tenant-context-and-authorization-2026-10.md` section 4.
