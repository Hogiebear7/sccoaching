# Tenant context and authorization (2026-10-07)

**Status:** implemented in PR 2 (`feat/tenant-context-and-route-scope-guard`). Additive. No existing route
was changed, and no behaviour changes for any caller.
**Base:** `redesign/index-html-blueprint` at `a6a27fa`.
**Plan:** `docs/iap-multitenant-implementation-plan-2026-10.md`. **Prior audit:** `docs/tenant-boundary-audit-2026-09.md`.

## 1. The model

A **tenant is a gym**. `UserRecord.gymId` is the tenant, and `null` is the primary gym, a real tenant like any
other (`lib/gym-scope.ts`). A user has **exactly one** gym, so a request's tenant is a property of the
authenticated account and never of anything the client sends.

| Question | Answer |
|---|---|
| Where does the tenant come from? | The stored account, resolved from the signed session (cookie or Bearer) at the first line of the route |
| Can a client choose it? | No. A gym id, header, query parameter or body field is only a **selector** to compare against the context |
| Can a downstream helper replace it? | No. `TenantContext` is frozen (`Object.freeze`), and the helpers take the context, never a gym id |
| Can a platform operator cross tenants? | No. Operators work as ordinary staff in their own gym. Platform-only actions are exact-role (`platform_operator`) capabilities, never a widened tenant check |
| Same user in two tenants? | Not representable: one `gymId` per account. Multi-gym membership is out of scope (audit 12.6, decision pending). The tests assert that a session resolves to the stored gym whatever else the request claims |
| What does a wrong-tenant lookup return? | Exactly what a missing one returns, so an error never confirms that a guessed id exists elsewhere |

## 2. What this PR adds

| File | Purpose |
|---|---|
| `lib/tenant-context.ts` | `buildTenantContext`, `inTenant`, `selectorMatchesTenant`, `tenantKey`, `cacheKey`, `platformScopeAllowed`. Pure, no datastore |
| `lib/tenant-request.ts` | `resolveTenantRequest` (member or staff session), `resolveStaffTenantRequest` (capability-gated, same 401 and 403 bodies as `authorizeStaffRequest`), `loadTenantUser` (fails closed), `tenantNotFoundResponse` |
| `lib/resource-scope.ts` | `COLLECTION_SCOPE` (typed against every `Database` key) and `MODULE_CACHE_SCOPE` |
| `lib/route-scope-manifest.ts` | One classified entry for each of the 227 routes under `app/api` |
| `lib/db.ts` | One additive type export, `DatabaseCollectionName` |

The existing routes are **not migrated** onto the new helpers in this PR. They already carry `sameGym` checks
with route-level tests (audit 12.1). The manifest records which check protects each one and fails when that
stops being true. **Correction (2026-10-07, post-merge audit):** an earlier version of this sentence said the new Google Play routes were written against the helpers. They were not, and at that point no production route used the helpers. Seven routes now do (including both Google Play routes), and the rest are listed in `docs/runtime-tenant-context-adoption-2026-10.md`. The route count is now 228, not 227, after `purchase-context` was added.

## 3. Drift guards (each one fails the build, and each was shown to fail by temporarily breaking it)

| Test | Fails when |
|---|---|
| `route-scope-manifest.test.ts` completeness | A route is added without a manifest entry, or an entry names a route that no longer exists |
| `route-scope-manifest.test.ts` evidence | A recorded tenant-check token (for example `sameGym(`) or capability is no longer in the route source |
| `route-scope-manifest.test.ts` staff guard | A route that calls `authorizeStaffRequest` is filed as `self` or `public`, or a staff-scoped route has no session check |
| `route-scope-manifest.test.ts` platform | A `platform` route is gated by a capability a tenant role holds, or a non-platform route uses a platform-only capability |
| `route-scope-manifest.test.ts` self | A route filed as `self` reads a client-supplied user or gym id (query, form data, body fields) |
| `resource-scope.test.ts` collections | A collection is added to `lib/db.ts` without being classified (also a `tsc` error), or a classification names an ownership field that no longer exists on the record |
| `resource-scope.test.ts` caches | A new module-level cache or `Map`/`Set` appears without being classified |

## 4. Audit results

Scope counts for the 227 routes (the manifest is the source of truth):

| Scope | Routes | Meaning |
|---|---|---|
| `self` | 117 | Acts only on the session user's own records. The user id comes from the session |
| `tenant-staff` | 54 | Staff capability plus a tenant check on every target |
| `self-tenant-checked` | 19 | Session user referencing a tenant-owned resource (class, post, package, invite) |
| `global-shared` | 16 | Staff over a platform-wide shared copy. See section 5 |
| `public` | 12 | No session. Credential, token or open by design |
| `platform` | 4 | Exact-role platform operator: gym moderation, finance ledger (create, delete), finance settings |
| `webhook` | 3 | Provider-authenticated. Tenant derived from stored records, never from the payload |
| `own-tenant` | 1 | Staff acting on their own gym only |
| `cron` | 1 | Platform operator session or `CRON_SECRET` |

| Surface | Result |
|---|---|
| **Collections (72)** | All classified. 44 user-owned, 5 gym-direct, 5 gym-via-parent, 3 money provenance, 4 credential, 4 global-shared, 6 platform-only, 1 identity |
| **Module caches** | `cachedClient` (Anthropic), `cached` (deployment config), `cached` (exercise-library Supabase client), `cachedToken` (Google service-account token): **global**, hold no tenant or user data. `buckets` (rate limiter): **keyed**, and every call site builds its key from the user id, the gym id, the client IP or a lower-cased email. No Next.js data cache (`unstable_cache`, `revalidate`, `"use cache"`) is used anywhere |
| **Background jobs** | Tenant-scoped by the member's gym since audit 12.1 (`jobs-gym-scope.test.ts`). The Google Play reconciliation and acknowledgement jobs arrive in PR 4 and use the same rule |
| **Webhooks** | Three. Each derives the tenant from the stored subscription or purchase's user. None reads a gym id from the payload |
| **Storage paths** | No tenant-keyed file storage exists. Uploaded images are stored as data URLs inside records (`lib/image-upload.ts`), built-in covers are static files |
| **Search** | Community search and the leaderboard are gym-scoped (`sameGym` evidence in the manifest). The exercise library and the food catalogue are shared by design |
| **Analytics and logs** | `aiUsageLogs` is user-owned. `aiRedirectEvents` is anonymous. This pass did not audit free-text console logging for personal data. That remains open |
| **Exports** | No route sets a CSV or attachment content type, so no bulk export route exists in `app/api` |
| **Seeds and migrations** | Existing scripts are idempotent backfills that default a missing `gymId` to the primary gym. PR 3 adds one with a dry-run mode |

## 5. Intentionally global, and what is still undecided

| Resource | Why it is global | Status |
|---|---|---|
| Exercise library and catalogue | One shared catalogue | Any gym's staff can mutate it. **Owner decision pending** (audit 12.2, 12.6) |
| Food catalogue, moderation queue and submissions | One shared catalogue | Moderation by any gym's `foodCatalog.manage`. **Owner decision pending** |
| `emails` and `readiness-alert` settings | Singletons | **Owner decision pending** |
| App Subscription package (`deliveryChannel: "app_only"`) | Sold through the shared app and store presence | Decision 8 (permanence) open. Creation is restricted to `platform_operator` (PR #56) |
| Finance ledger, revenue events, payment events | Platform money. `ownerGym` is immutable provenance, not access control | Reads and writes are exact-role `platform_operator` (PR #32) |

Registering these here does not approve them. It makes each one a visible, reviewed exception, and the manifest
test requires a note for every `global-shared` route.

## 6. Limits of this PR, stated plainly

- The guards prove the **recorded** check is still present in each route's source. They do not prove the check is
  *sufficient*. Sufficiency is established by the route-level isolation tests that already exist for each
  tenant-scoped route (`__tests__/api/*-gym-scope.test.ts`) and by review. The tests are not mapped one-to-one to
  routes automatically, because many import the handler through a computed path.
- The `self` check is a pattern heuristic over common ways of reading a client-supplied id. A route that reads one
  in an unusual way would not be caught.
- Eight `tenant-staff` and eleven `global-shared` routes have no route-level test that imports them by literal
  path. Several of those are exercised through computed-path tests (for example the catalog routes). This PR does
  not claim they all are.
- Nothing here is a database-level row-level-security control. The datastore is a JSON file, and the checks are
  application-layer by necessity (plan section 3).
- No network, provider, production data or secret was touched to produce this audit.
