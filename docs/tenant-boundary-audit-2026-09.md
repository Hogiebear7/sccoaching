# Tenant-boundary architecture audit — 2026-09

Read-only audit of `gym-app` and `sc-coaching-mobile` against
`docs/white-label-platform-master-plan.md`, performed 2026-09-17. No files
were changed to produce this audit. All findings below reflect the state of
the codebase at that date — re-verify file:line references before acting on
them if this document is read much later.

## 1. Current architecture map

**Repos**: `gym-app` (Next.js App Router — web app, staff admin dashboard,
all API routes; single flat JSON datastore via `lib/db.ts`; deploys to
Hostinger from `redesign/index-html-blueprint`) and `sc-coaching-mobile`
(Expo/React Native, EAS-built for iOS/Android; **no automated test suite at
all** — zero `__tests__`/`*.test.*` files anywhere in that repo).

**Staff/admin surfaces** (`app/(staff)/staff/*/page.tsx`) — 15 distinct
pages: Overview/Operations, Classes (+ per-class workout), Members (+ member
detail), Attendance, Messages, Catalog, Exercises, Exercise Library, Staff
Users, Finances, Reports, Bug Reports, Nutrition Submissions, Community
Reports.

**Mobile surfaces** — member app: 5 tabs (Home, Schedule, Workouts,
Recovery, Nutrition), mirroring the web dashboard 1:1. Staff app: a
**separate** 4-tab set (Classes, Workouts, Members, Messages) — built
separately because coaches have no `ProfileRecord` and reusing member tabs
would error. Root layout routes by `role` only; there is no gym-context
concept anywhere in the routing.

**Data layer** — one JSON file (`data/db.json`), read/written wholesale via
`readDb()`/`writeDb()` in `lib/db.ts` (~4,480 lines). The `Database`
interface has ~65 top-level collections, each a flat array. Every accessor
follows a consistent `findXByUserId` / `findXById` / `createX` / `updateX`
naming convention — this is the only real "repository pattern" in the
codebase; no ORM, no query builder, no shared filtering layer beyond
individual helper functions.

## 2. Current data and permission model

**Session/auth**: `SessionPayload = { userId: string }` (`lib/session.ts`)
— nothing else: no role, no gymId, no expiry claim. HMAC-signed,
`timingSafeEqual`-compared. Web carries it as a cookie with no `maxAge`;
mobile carries the identical token as an `Authorization: Bearer` header via
`lib/mobile-auth.ts`'s `verifyRequestSession`, stored client-side in
`expo-secure-store` (with a `localStorage` fallback on RN-web build targets
— XSS-exposed if that target is ever reachable by untrusted content).

Inconsistency found: `lib/staff-auth.ts`'s `authorizeStaffRequest()` reads
the cookie only, bypassing `verifyRequestSession` — any route still using it
will not authenticate a mobile Bearer-token request at all. Worth an
inventory of which staff routes use which helper before mobile-staff work
expands.

**`UserRecord`** (`lib/profile-schema.ts:41-61`): `id, email, role,
archivedAt, gymId?: string|null, createdAt, updatedAt`. That is the entire
shape. **No multi-org membership concept exists anywhere** — `gymId` is a
single nullable scalar; `null` means "the primary gym" by convention, not by
type enforcement. `lib/db.ts:18` — `StoredUser = UserRecord & { passwordHash
}`. `UserRole` is `"member"|"coach"|"admin"|"admin_manager"|"staff"`
(the last a legacy alias, migrated to `admin_manager` on read).

**Capability model** (`lib/permissions.ts:43-109`) — 20 capabilities,
hierarchical roles (`coach < admin < admin_manager`):

| Capability | Min role | Capability | Min role |
|---|---|---|---|
| staff.access | coach | staffUsers.manage | admin_manager |
| classes.manage | coach | finance.view | admin_manager |
| exercises.manage | coach | reports.view | admin |
| members.view | coach | programs.manage | coach |
| members.edit | coach | nutrition.manage | coach |
| members.coaching | coach | foodCatalog.manage | admin |
| members.account | admin | bugReports.manage | coach |
| members.hardDelete | admin_manager | comments.moderate | coach |
| members.billing | admin | gyms.moderate | admin_manager |
| catalog.manage | admin | gym.manageAvailability | admin |
| operations.view | admin | | |

Only `gyms.moderate` and `gym.manageAvailability` concern the multi-gym
layer directly. The other 18 are role-gated but **not** gym-scoped by the
capability system itself — gym-scoping is a separate, orthogonal check
layered on per-route via `lib/gym-scope.ts`, not centralized.

**Coach visibility**: no assigned-coach/roster model exists — zero hits for
`assignedCoach` or a `coachId` field on a member record in either repo.
Scoping is entirely "same gym": every coach at a gym sees every member of
that gym, with no finer-grained "my clients only" concept.

## 3. Where tenant ownership is explicit, implicit, or missing

**Explicit** (a real `gymId`/tenant field, added this session): only
`UserRecord.gymId` and `GymRecord` itself (`lib/gyms-schema.ts`), plus the
~13 routes wired through `sameGym()`/`sameGymAsStaff()`
(`lib/gym-scope.ts`): `app/api/staff/members/update`,
`app/api/staff/members/[userId]/{tier,subscription,pause,extra-sessions,
delete,archive,ai-usage}`, `app/api/mobile/staff/{programs/*,
nutrition-target/*, messages/[memberId], members/[userId]}`, and the staff
Members/Attendance/Messages pages.

**Implicit** (derivable only by joining through the owning user's `gymId`,
never stored on the record itself): all 31 collections in
`MEMBER_OWNED_COLLECTIONS` (`lib/db.ts:2288-2297`) — workouts, bookings,
recovery, nutrition, messages, coach notes, subscriptions, purchases, etc.
Correct today only because there is exactly one gym; would need either a
stored `gymId` or a guaranteed-correct join at every read site once a second
gym exists.

**Missing entirely** (no gym field, no join path — genuinely global tables):
`classes`, `classCategories`, `classSeries`, `bookings`-as-scheduling-content
(`lib/db.ts:714-779`, confirmed no `gymId` field on `ClassRecord`/
`ClassCategoryRecord`/`BookingRecord`), `exercises`, the community feed
(`workoutComments`, `workoutLikes`, `commentReports`), `invites`, the entire
catalog (`MembershipPackageRecord`, `MembershipCategoryRecord`,
`MembershipBillingOptionRecord`), and all five money-record types (below).
`lib/db.ts` states this outright in a comment on `FollowRecord`: *"single-
tenant app, every member is a valid target."*

## 4. Payment architecture findings

**Stripe**: exactly one fixed secret key and one webhook signing secret for
the entire app (`lib/app-config.ts:74-80`, read by `lib/providers/
stripe.ts:20-23`'s `getSecretKey()`). Zero mentions of Connect, connected
accounts, `on_behalf_of`, or `application_fee` anywhere in `lib/` — not even
a comment. `MembershipPackageRecord.stripeProductId` /
`MembershipBillingOptionRecord.stripePriceId` are plain global ids, assumed
to live in the one platform account. Webhook route: `app/api/stripe/
webhook/route.ts`, handling `checkout.session.completed` (+ async variants),
`charge.refunded`, `invoice.paid`/`invoice.payment_succeeded`,
`invoice.payment_failed`, `customer.subscription.deleted`.

**Google Play Billing**: real, server-verified (not client-trusted) —
`app/api/mobile/billing/google-play/verify/route.ts` re-checks live against
Google; `app/api/webhooks/google-play/route.ts` is the RTDN push endpoint.
No gym/tenant dimension on `GooglePlayPurchaseRecord` (`lib/db.ts:1088`).

**Apple IAP**: no server-side handler exists at all — `apple_iap` is only a
`BillingChannel` enum value used for catalog labeling (`lib/db.ts:997`,
`lib/catalog.ts:20,28-32`).

**Money records** — none of `SubscriptionRecord` (`lib/db.ts:890-946`),
`PurchaseRecord` (`1112-1134`), `RevenueEventRecord` (`1408-1422`),
`MembershipPackageRecord` (`1004-1039`), or `FinanceLedgerEntryRecord`
(`1557-1607`) carry a gym field.

**Idempotency exists and is layered** (signature verification →
event-id dedupe → purchase state-machine transitions → a secondary
invoice-id dedupe for `invoice.paid`/`invoice.payment_succeeded` firing
twice) — this part is solid. But the whole webhook path is **structurally
single-account**: `verifyStripeSignature` checks against exactly one global
secret, no code anywhere reads Stripe Connect's `event.account`, and every
downstream `find*By...` lookup searches one global table assuming
provider-order-ids are globally unique (true only because there is one
account). Supporting Connect would need: accepting/verifying against N
webhook secrets (or the Connect platform secret + `event.account`); using
`event.account` to resolve a tenant *before* any record lookup; a tenant key
on every money record and every `find*` query that touches one; and
parameterizing `getSecretKey()` so checkout-session creation can pick a
connected account's key. None of this exists even as a stub — this is real
rework, not an added column.

**Finances ledger has no gym filter at all**: `buildFinanceLedgerLines()`
(`lib/finance.ts:45`) takes **no arguments** and unconditionally calls
`findAllRevenueEvents()`, `findAllPurchases()`, `findAllFinanceLedgerEntries()`,
`findAllAiUsageLogs()` — every `findAll*` returns the entire table, no
scoping parameter exists on any of them. The Finances UI filters the result
in memory by date/status/kind/age-bracket only. This is a genuine
platform-wide ledger today, correct only because there is exactly one gym.

## 5. Branding findings

Zero runtime resolution exists. Confirmed hardcoded "S&C" in:

- **9 separate AI system prompts** in `lib/ai.ts` (coaching assistant,
  nutrition coach, meal-suggest, food-photo ID, food-description parser,
  receipt extractor, tracker import, two programme-skeleton prompts).
- **`lib/email-templates.ts`** — brand name/wordmark in the header, the
  footer sign-off ("— S&C Performance Coaching") at 11+ separate line
  locations, plus brand-naming copy in several transactional messages.
- **`lib/ics.ts:57`** — `PRODID:-//S&C Performance Coaching//Booking//EN`
  hardcoded into every calendar invite.
- **Mobile `app.json`** — app name, iOS `CFBundleDisplayName`, bundle
  identifier `com.sandcperformancecoaching.app`, Android package, splash/
  icon background colour, and camera/location permission-prompt strings.
- **Mobile theme** (`src/constants/theme.ts:1-6`) — explicitly documented
  as "the only theme, no system-appearance branching," fixed navy/gold hex
  values, not tokens.
- **Mobile logo** (`src/components/ui/BrandMark.tsx:9,18`) — a static
  compile-time `require()` of a PNG plus a hardcoded accessibility label.
  No prop, context, or data lookup.
- Additional direct "S&C" string literals confirmed across several mobile
  screens, plus a hardcoded API base URL (`src/constants/config.ts:16`,
  `https://sandccoaching.com`).

`lib/content.ts` (the existing `BRAND_NAME`/`BRAND_TAGLINE`/`CONTACT_INFO`
constants) is confirmed **not** wired to `findGymBySlug` — the two are
entirely disconnected sources of "brand truth" today.

## 6. Risk register

| Risk | Severity | Why |
|---|---|---|
| Finances ledger has no gym filter | **Critical** (as designed, once tenant #2 exists) | Full cross-tenant revenue/expense leak by construction — every gym's money would appear in every other gym's ledger. Not exploitable today (one gym). |
| Global payment architecture (one Stripe key, no Connect groundwork, `event.account` never read) | **Critical** (structural, blocks Phase 5) | Real rework required, not an added field — see §4. |
| Queries with no explicit tenant scope (virtually every `findAll*`) | **High** | General form of the Finances issue — classes, exercises, catalog, community are all "select everything" by default. |
| Client-supplied IDs trusted with no ownership check: community-report resolution | **High** | Invite revocation and class mutations were closed by the cross-gym authorization fix merged in PR #4 (merge commit `e456e06`), with route-level denial tests. Exercise-library routes (`app/api/staff/exercise-library/*`) were never a gap — they operate on intentionally platform-global shared exercise-library data, not gym-owned records. Community-report resolution (`app/api/staff/community/reports/[id]/resolve`) remains open: Community's platform-global-vs-gym-scoped ownership model still needs a product decision before gym-scoping can be added without creating a moderation blind spot. The four page-level server components that also call `sameGym` remain untested (not unprotected) — deferred because no dedicated Server Component test harness exists in this repo. |
| Messages/community crossing tenant boundaries | **Medium–High** | Staff-to-member messaging is correctly `sameGym`-gated; the community feed (comments/likes) is a platform-global feed by explicit design comment, with no gym field at all. |
| Metrics/Finances visible to wrong tenant | **Critical** | Same root cause as the Finances row above. |
| Payments attributed to wrong business | **Critical** | Every money record's gym is only derivable via the payer's own `gymId`, never stored on the transaction — exactly the ambiguity Connect exists to resolve, entirely unaddressed today. |
| Webhooks not tenant-aware | **Critical** (for Phase 5, not urgent now) | Good idempotency; zero tenant resolution. |
| Files/media without tenant ownership | **Low today / Medium for Phase 4** | No asset-upload system exists yet for branding at all — not a leak risk yet, becomes one the moment tenant logo upload exists without an ownership model. |
| Branding hardcoded to S&C | **Medium** | Not a security risk — a completeness/effort risk, deeper than expected (see §5). |
| Global users vs. tenant memberships (no multi-gym support) | **Medium** | Open decision, not yet a risk — see §8. |
| Staff belonging to multiple tenants | **Medium** | Unsupported by the single-scalar `gymId`; deliberately deferred. |
| Null/fallback gym IDs | **Medium** | The `null == primary gym` convention is deliberate and was already handled carefully once (the availability-toggle route added an explicit secondary check rather than trusting the fallback alone) — convention-based, not type-enforced; every future route touching it needs the same discipline. |
| Admin capabilities broader than intended (`gyms.moderate` can act on any gym by id) | **Medium** | Almost certainly correct as platform-operator-only by the code's own comment, but not currently reserved to a role distinct from any tenant's own `admin_manager`. |
| "Primary gym" assumptions that may not scale | **Medium** | Several routes have S&C-as-primary-gym baked in as a named constant, not just a data row (availability toggle, nearby-search recommendation ranking). |

## 7. Session-token expiry — resolved

Originally recorded here in September 2026 as a related-but-out-of-scope
finding: session tokens carried no expiry claim and the web cookie had no
maxAge, so a leaked cookie or mobile bearer token remained valid
indefinitely.

Status: closed. The fix was implemented on branch `fix/session-expiry` and
merged into `redesign/index-html-blueprint` as merge commit `c8608bf`,
containing implementation commit `220e053`.

`lib/session.ts` now signs internal `iat` and `exp` claims. `verifySession()`
enforces absolute expiry server-side: when `Date.now() >= exp`, the token is
rejected through the existing invalid-session path. This is the shared
verification point used by:

- `verifyRequestSession()` for cookie and Bearer authentication;
- `authorizeStaffRequest()`;
- `requireStaffPage()`.

Session lifetimes are tiered:

- members: 7 days;
- staff/admin: 24 hours.

The lifetime is selected dynamically using `isStaffRole(user.role)` at the
shared web-login, mobile-login, and web-handoff paths, and statically at the
member signup and gym-owner signup paths. Web cookies receive a matching
maxAge. Mobile Bearer tokens are subject to the same server-side expiry
enforcement.

Every token issued before this change lacked `iat` and `exp` and was
rejected after deployment. This caused a one-time global reauthentication
event for all existing web and mobile users, including members and staff.

Deliberately deferred as separate future security decisions:

- sliding or rolling renewal;
- a database-backed session store;
- server-side revocation;
- logout-all-devices;
- password-change invalidation;
- refresh-token rotation;
- risk-based reauthentication;
- idle timeout;
- a global web client-side 401 interceptor.

Mobile already handles 401 responses globally. Web currently relies on
per-request and per-page server-side checks. Expired sessions in long-lived
open web tabs may therefore produce a raw 401 or an incomplete page state
until the next navigation; this is recorded as a separate UX follow-up and
is not part of the session-expiry fix.

## 8. Recommended future tenant model (proposal only — not implemented)

1. **Tenant entity**: today's `GymRecord` already has close to the right
   shape (id, slug, name, branding fields, `ownerUserId`, status) — likely
   promotable directly rather than inventing a parallel concept.
2. **Tenant-membership relationship**: today's single `UserRecord.gymId`
   scalar would need to become a real join (`TenantMembership: { userId,
   tenantId, status }`) only if multi-tenant staff/members becomes a
   requirement — see the open decision in §9.
3. **Staff/coach assignment**: role + `sameGym` is enough for "assigned to a
   tenant" as-is. A finer "assigned members only" model is a separate, later
   decision, not a tenancy prerequisite.
4. **Tenant-scoped permission model**: extend `can(role, capability)` with a
   second, orthogonal gym/tenant-scope check at each route — exactly the
   pattern already used for member routes. Keep the two concerns separate,
   as the codebase already does.
5. **Entities needing a tenant key**: classes, class categories, class
   series, bookings, exercises, community content, invites, the catalog, and
   eventually the five money-record types once Connect is in scope.
6. **Entities that should stay platform-level**: the shared food database,
   the raw AI-usage cost log (though its *reporting* would need tenant-aware
   grouping), platform-wide settings, and — a genuine open question — the
   exercise-movement library's content itself vs. which gyms/coaches use it.
7. **S&C as reference tenant**: already the case in practice — `GymRecord`
   #1, `PRIMARY_GYM_SLUG` already a named constant, null-gymId already
   convention-mapped to S&C.
8. **Onboarding an external gym later**: real groundwork already exists —
   `app/api/gyms/signup` creates a `pending` gym + scoped owner account.
9. **Shared tenant-aware admin portal**: today's staff dashboard already has
   the right shape (single app, role-gated pages); the missing piece is a
   tenant-context resolver at the top of each page, not a rebuild.
10. **Runtime branding resolution**: genuinely new work — today's constants
    and mobile compile-time assets have no resolution step at all.
11. **Platform billing vs. member billing**: only member billing exists
    today; platform billing (S&C charging a tenant owner) doesn't exist in
    any form — a clean separate flow to build later.
12. **Where Stripe Connect fits**: after tenant identity and scoped queries
    exist (Phase 2+) — building it earlier means building it against a
    schema that doesn't know what a tenant is yet.

## 9. Decisions still required

1. **Can a member belong to more than one gym?** Determines whether
   `UserRecord.gymId` can stay a scalar or must become a join table — the
   single biggest fork in the whole plan.
2. **Merchant of record for tenant memberships** — each gym its own legal
   merchant (favors Connect) vs. S&C staying merchant-of-record for everyone
   (simpler, but conflicts with the plan's own preference for tenant-owned
   payment accounts). Legal/tax question, not an engineering one.
3. **Is `gyms.moderate` reserved for a genuinely separate platform-operator
   role**, distinct from any tenant's own `admin_manager`? Needs an explicit
   answer before a second gym's top role could ever hold it.
4. **Which entities get a tenant key first** — classes/exercises/community
   are the concrete, already-identified gaps; the order matters because each
   is a real migration.
5. **Data retention/export/deletion per tenant** — not designed at all
   today; the source plan calls this out as a pre-pilot gate.
6. **Do AI system prompts and email templates get a runtime brand-name
   parameter, or stay S&C-only until Phase 4?** A scoping decision for how
   much of the hardcoded-S&C surface gets touched in Phase 1 vs. deferred
   entirely.
7. **Stripe Connect vs. an alternative connected-account model** — needs
   confirming against actual country/currency/tax situation before any
   implementation.

## 10. Deferred work

Everything named in `docs/white-label-platform-master-plan.md`'s non-goals
list: the `Tenant` model itself, Stripe Connect, separate branded apps, a
marketplace, tenant billing, custom domains, a rebuilt admin portal, any
database refactor, broader role complexity, and any speculative code change.
Also, specifically: full marketplace discovery (reviews/ratings),
multi-location franchise reporting, automatic booking-capacity inference,
cross-tenant analytics, a full accounting system, and building payment flows
before ownership/tax/legal decisions are made.

## 11. Recommended next code slice (not implemented in this Phase 0 pass)

**Add route-level cross-gym denial tests for the routes already claiming
`sameGym`/`sameGymAsStaff` protection.** Today, `sameGym()` itself is
unit-tested in isolation (`__tests__/lib/gym-scope.test.ts`), but none of the
~13 routes that call it have a test asserting that a staff user from a
*different* gym is actually denied at the route level — presence-of-check is
verified, wiring-into-the-route is not. This is pure test-writing against
existing, already-shipped behaviour: no schema change, no new product
surface, lowest possible risk, and it closes the single most concrete gap
this audit found. Recommended as the first slice to propose after this
Phase 0 documentation is reviewed — intentionally **not** implemented here.
