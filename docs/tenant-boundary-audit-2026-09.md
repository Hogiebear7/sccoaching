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
(the last a legacy alias, migrated to `admin_manager` on read). *Update
2026-09-25: a `platform_operator` role was added by PR #32 — implemented,
deployed and verified in production; see §12.5.*

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

*Update 2026-09-25 (PR #32, see §12.5): the table above is the state at the
time of this audit. `finance.view` and `gyms.moderate` are now satisfied by the
exact `platform_operator` role only (checked by role, not by rank or `gymId`),
so `admin_manager` no longer holds them; a new `platform.jobs` capability, also
operator-only, gates the session-authenticated cron path. Implemented, deployed
and verified in production.*

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
| Finances ledger has no gym filter | **Critical** (as designed, once tenant #2 exists) | Full cross-tenant revenue/expense leak by construction — every gym's money would appear in every other gym's ledger. Not exploitable today (one gym). *Update 2026-09-25: tenant roles can no longer reach the ledger — `finance.view` is exact-role `platform_operator` since PR #32 (deployed and verified in production, §12.5). The ledger still has no gym field, so the structural risk stays open (§12.6).* |
| Global payment architecture (one Stripe key, no Connect groundwork, `event.account` never read) | **Critical** (structural, blocks Phase 5) | Real rework required, not an added field — see §4. |
| Queries with no explicit tenant scope (virtually every `findAll*`) | **High** | General form of the Finances issue — classes, exercises, catalog, community are all "select everything" by default. |
| Client-supplied IDs trusted with no ownership check: community-report resolution | **High** | Invite revocation and class mutations were closed by the cross-gym authorization fix merged in PR #4 (merge commit `e456e06`), with route-level denial tests. Exercise-library routes (`app/api/staff/exercise-library/*`) were never a gap — they operate on intentionally platform-global shared exercise-library data, not gym-owned records. Community-report resolution (`app/api/staff/community/reports/[id]/resolve`) remains open: Community's platform-global-vs-gym-scoped ownership model still needs a product decision before gym-scoping can be added without creating a moderation blind spot. The four page-level server components that also call `sameGym` remain untested (not unprotected) — deferred because no dedicated Server Component test harness exists in this repo. |
| Messages/community crossing tenant boundaries | **Medium–High** | Staff-to-member messaging is correctly `sameGym`-gated; the community feed (comments/likes) is a platform-global feed by explicit design comment, with no gym field at all. |
| Metrics/Finances visible to wrong tenant | **Critical** | Same root cause as the Finances row above. *Update 2026-09-25: platform Finance and mobile Business revenue are no longer reachable by tenant roles (PR #32, §12.5); the per-gym scoping decision remains open (§12.6).* |
| Payments attributed to wrong business | **Critical** | Every money record's gym is only derivable via the payer's own `gymId`, never stored on the transaction — exactly the ambiguity Connect exists to resolve, entirely unaddressed today. |
| Webhooks not tenant-aware | **Critical** (for Phase 5, not urgent now) | Good idempotency; zero tenant resolution. |
| Files/media without tenant ownership | **Low today / Medium for Phase 4** | No asset-upload system exists yet for branding at all — not a leak risk yet, becomes one the moment tenant logo upload exists without an ownership model. |
| Branding hardcoded to S&C | **Medium** | Not a security risk — a completeness/effort risk, deeper than expected (see §5). |
| Global users vs. tenant memberships (no multi-gym support) | **Medium** | Open decision, not yet a risk — see §8. |
| Staff belonging to multiple tenants | **Medium** | Unsupported by the single-scalar `gymId`; deliberately deferred. |
| Null/fallback gym IDs | **Medium** | The `null == primary gym` convention is deliberate and was already handled carefully once (the availability-toggle route added an explicit secondary check rather than trusting the fallback alone) — convention-based, not type-enforced; every future route touching it needs the same discipline. |
| Admin capabilities broader than intended (`gyms.moderate` can act on any gym by id) | **Medium** (was; now addressed) | Was: not reserved to a role distinct from any tenant's own `admin_manager`, so any gym owner could approve or suspend any gym. **Addressed by PR #32:** `gyms.moderate` is exact-role `platform_operator`, and no gym can change its own status. Implemented, deployed and verified in production (§12.5). The initial operator was promoted through a one-time, dry-run-first script; no route or UI can assign the role. |
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
   **Decided and implemented (PR #32, 2026-09):** yes — a dedicated
   `platform_operator` role, satisfied by exact role only. Implementation is
   deployed and was verified in production; see §12.5. What remains is not
   this decision but its neighbours: per-gym Finance ownership and merchant of
   record (item 2) and the platform/tenant split for other global data (§12.6).
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


## 12. Follow-up audit — after the PR #22–#26 isolation slices (2026-09)

Re-audit of every `app/api/**` route (227), web page, `lib/**` data module,
scheduled job and notification path, done after the tenant-isolation slices
merged as PRs #22–#26. Method: every route/page was checked for a trusted
ownership chain to a gym, whether the check runs before data is returned and
before every mutation, missing-owner behavior, and client-input influence.
`gymId: null` is the primary gym throughout (`lib/gym-scope.ts`).

**Update (2026-09-25).** After this audit, four further security fixes shipped
(PRs #32, #34, #35): the platform-operator role and its account protection, a
staff rank-target guard, and archived-session enforcement. They are recorded,
with their status, verification and deployment state, in §12.5. Three rows
below that were blocked at the time of writing are no longer open as described;
§12.2 is annotated accordingly, and everything still open is consolidated in
§12.6.

### 12.1 Fixed in this pass

| Sev | Surface | Ownership path | Fix |
|---|---|---|---|
| P1 | `lib/reports.ts` (Reports page, mobile Business membership/class sections) | member / class → coach → gym | Rows scoped to the acting staff gym before any profile/booking lookup |
| P1 | `lib/staff-operations.ts` (Operations page) | member / class → coach → gym | Same |
| P0/P1 | `POST /api/ai/coach-summary`, `/api/ai/draft-reply` | client `memberId` → member gym | Cross-gym member → existing 404, before any data load or AI call |
| P1 | `/staff/classes/[classId]/workout` (web page) | class → coach → gym | Cross-gym / unowned class → existing "Class not found", before any lookup |
| P1 | `/staff/bug-reports` page, `bug-reports/status`, `bug-reports/delete` | report → reporter → gym | List scoped; cross-gym report → existing 404 before any write |
| P1 | `grantMemberTier(…, "membership")` (staff tier route, bulk tier, invite redemption) | package → category → gym vs. **receiving member's** gym | Default pick and explicit `packageId` both restricted to the member's gym; foreign package reads like an invalid one |
| P1 | `POST /api/recovery/log` low-readiness alert | member → gym | Alert + push go only to non-archived staff in the member's gym (was: every gym's staff) |
| P2 | `POST /api/invites/redeem` (existing account) | invite → `invitedByStaffId` → gym | Cross-gym / unresolvable inviter → same "invalid link" response |
| P2 | `GET /api/staff/messages/unread-count` | thread → member → gym | Badge counts only the acting gym's members (was platform-wide) |
| P2 | Lapsed-membership + drop-lapsed jobs | member → gym | System message attributed to a staff user in the **member's** gym (was: first staff account of any gym); no same-gym staff → message skipped, notification/tier drop still happen |
| P2 | Attendees / waitlist members on an in-gym class (mobile list + detail, web list + workout page) | member → `gymId` (trusted, on the user record) | Legacy cross-gym member left out; profile never read. `bookedCount` stays the real count |
| P2 | `getStaffMembersData`, `getStaffTrainingPrograms` | member → gym | Filter moved before profile/subscription/email lookups (was load-then-filter) |

Every fix has two-gym tests asserting returned data **and** data-access calls.

### 12.2 Blocked — needs a decision (not implemented)

| Sev | Surface | Why blocked |
|---|---|---|
| ~~**P0**~~ | ~~`POST /api/staff/gyms/[gymId]/status` (`gyms.moderate` = `admin_manager`)~~ | **Resolved by PR #32 (§12.5).** `gyms.moderate` is now exact-role `platform_operator`, and no gym may change its own status. Original problem: `POST /api/gyms/signup` (public) creates the new gym's owner as `admin_manager`, so any gym owner could self-approve a pending gym or suspend any other gym |
| P1 | Finance: ledger read/create/edit/delete, `/staff/finances`, mobile Business revenue, purchases, revenue events | **Access interim-restricted by PR #32 (§12.5):** `finance.view` is exact-role `platform_operator`, so no tenant role reaches it. **Still open (§12.6):** `FinanceLedgerEntryRecord` has no gym (schema); per-gym ownership, revenue attribution, merchant of record and tax undecided |
| P1 | Global data mutated by any gym's staff: exercise library and `staff/exercises*`, class categories (`staff/categories*`), class workout templates (`staff/workout-templates*`), singleton settings (`staff/settings/emails`, `readiness-alert`) | No gym on the records; needs a global-vs-per-gym decision per entity (templates carry `createdByStaffId`, so per-gym is derivable if chosen). `staff/settings/finance` is no longer in this row: it is platform-operator-only since PR #32 |
| ~~P2~~ | ~~`POST /api/cron/run`~~ | **Resolved by PR #32 (§12.5).** The session path now requires exact-role `platform_operator` (`platform.jobs`); the `CRON_SECRET` path is unchanged and its comparison is now constant-time. Original problem: any gym's admin could run the platform-global job set |
| P2 | Nutrition moderation / submissions (web + mobile) | Moderates the shared food catalog; submitter identity visible across gyms |
| P2 | Signup gym assignment | Self-signup and signup-time invite redemption always land in the primary gym; needs a gym-selection/invite-gym decision |
| P2 | Single Stripe / Revolut / Google Play secrets | One webhook topology, one merchant account; Connect / per-gym accounts undecided |
| P2 | Google Play token first-claim | An unverified valid token can be claimed by the first account to submit it; needs `obfuscatedExternalAccountId` bound at purchase time (client + provider change) |

### 12.3 Reviewed, no change

Member-owned routes (own workouts, programs, nutrition, profile, notifications,
bookings/cancel, waitlist/leave, community comment delete, gym-profiles) are
scoped by the session user's id — PASS. The gym directory (`gyms/nearby`,
`geocode`) is public discovery by design. `gym.manageAvailability` acts only on
the caller's own gym. Scheduled jobs are platform-global runs by design; they
act per record and notify only the record's own user (the two fan-outs above
were the exceptions). `(admin)` / `(admin-mobile)` pages render static
`lib/mock-data` only — no tenant data.

### 12.4 Readiness estimate (judgement, not a measurement)

Route-level authorization ≈ 85%, read isolation ≈ 88%, mutation isolation
≈ 85%, background/async ≈ 80%, payments/Finance ≈ 25%, platform/operational
≈ 30%. Weighted 20/20/20/10/15/15 ≈ **68%** (plausible range 62–74%). The
remaining gap is almost entirely the blocked decisions above; more code alone
does not reach 75–80%.

*This estimate predates PRs #32, #34 and #35 and has not been re-scored; no
updated figure is claimed here.*

### 12.5 Platform-boundary and account-security fixes (after 12.1–12.4)

All four items below are code changes with regression tests, and all four are
implemented and merged. Implementation, deployment and production verification
are recorded separately, because they are different claims: **implemented** =
merged with passing tests; **deployed** = the release containing it was
reported live on the production host; **verified in production** = the
behaviour was actually exercised there. "Not confirmed" means this record has
no confirmation of that step. Nothing here changed the schema, migrations, the
app-only global-catalog policy or signup gym assignment.

| # | Fix | Status | Implementation (high level) | Verification | Deployment |
|---|---|---|---|---|---|
| 1 | **Platform-operator role and boundary** (PR #32, merge `81be768`) | Done | New `platform_operator` role in `lib/permissions.ts`, rank 4 but never implied by rank or `gymId: null`. `gyms.moderate`, `finance.view` and `platform.jobs` are satisfied by the **exact role only** (`PLATFORM_ONLY_CAPABILITIES`). Gym-status route is operator-only and refuses a gym changing its own status; `cron/run` session path requires `platform.jobs` and compares `CRON_SECRET` in constant time. The role is not in `ASSIGNABLE_STAFF_ROLES`: it is granted only by the dry-run-first `scripts/promote-platform-operator.mjs` (explicit single target, `--confirm` to write, backup first). Public gym signup still creates an ordinary `admin_manager` | 1,786 tests / 162 files, TypeScript and ESLint clean at merge. Production: the promotion was run once, dry run first, against one explicitly named owner account, with independent backups taken; the role and the platform Finance and Classes pages were checked in production afterwards | **Deployed and verified** |
| 2 | **Operator-target protection** (PR #32) | Done | `protectedOperatorTarget` in `lib/platform-operator-guard.ts` makes an operator account read as "not found" to a non-operator on `members/reset-password`, `members/update`, `staff-users` (role change) and `staff-users/archive`, before any mutation. No route can create or promote to the role | `platform-operator-account-protection`, `platform-operator-capabilities`, `platform-boundary-characterization` and `promote-platform-operator-script` tests; staff-users and finance-ledger tests re-pointed to operator fixtures. Still passing in every later run (1,861 tests at PR #34, 1,912 at PR #35) | **Deployed** (with #1). Production verification: the protection itself was not exercised in production; it is covered by tests |
| 3 | **Staff rank-target guard** (PR #34, merge `0377889`) | Done | `targetOutranksActor(actor, target)` in `lib/platform-operator-guard.ts`, using the canonical rank via `roleRank` in `lib/permissions.ts`. Applied to `members/reset-password` and `members/update`: a target ranked strictly above the actor reads exactly like a missing user (existing 404) before any reset token, email change or profile save. Equal and lower ranks are unchanged; the legacy `staff` alias ranks as `admin_manager`; null and unknown roles rank as member. Closes the path where a gym `admin` could mint a reset link for, or re-email, the gym's `admin_manager`. A coach can no longer edit a higher-ranked staff profile through `members/update` (intentional) | `staff-account-rank-guard` and `target-outranks-actor` tests, mutation-checked (they fail without the guard). 1,861 tests / 165 files, TypeScript and ESLint clean at merge. Production behaviour was not separately exercised | **Deployed** — the maintainer reported release `0377889` as the current production deployment; this record has not independently checked it. Production verification: not performed |
| 4 | **Archived-session enforcement** (PR #35, merge `1733533`) | Done | `verifyRequestSession` in `lib/mobile-auth.ts` now returns no session when the token's account is missing or archived, for both cookie and Bearer transports (a Bearer token for an archived account is not retried against the cookie). `/api/auth/web-handoff` no longer issues a fresh session cookie to an archived account. `proxy.ts` treats an archived or deleted account as having no session, so `/dashboard` redirects to `/login` without a redirect loop. Applies to staff and members; restoring an account makes its existing valid token work again. Unauthorized responses are the routes' existing ones and do not reveal archive status. No revocation list, session versioning, refresh-token or lifetime change | `verify-request-session-archived`, `web-handoff-archived`, `proxy-archived` and `archived-actor-routes` tests (six representative routes, mutation-checked); two existing tests updated to set up a live account. 1,912 tests / 169 files, TypeScript and ESLint clean at merge | **Merged; deployment and production verification not confirmed** |

Related, not a security fix: PR #33 added `scripts/remove-revenue-events.mjs`,
an explicit, dry-run-first tool for removing named webhook revenue events
(revenue events are append-only and have no delete route). It was used once in
production to remove three test payments; it changes no application behaviour.

### 12.6 Still open

None of the following was changed by PRs #32, #34 or #35.

| Area | Status | Notes |
|---|---|---|
| Rate limiting | **Open** | Public gym signup, auth signup and cron are unlimited. Gym signup is anonymous and creates a tenant plus an admin account, so it is the most abusable |
| Unaudited member-scoped routes | **Open** | Not audited for role or target checks: `members/[userId]/tier`, `subscription`, `pause`, `extra-sessions`, `notes`, `ai-usage`, bulk tier. The tier route has no role check on its target. These are not account-security actions, but they are not covered by the rank guard |
| Archived-actor follow-ups not covered by the central fix | **Open** | (a) Tokens remain stateless: there is still no revocation, so an archived account's token is valid again on restore, and lives to its 24-hour (staff) or 7-day (member) expiry either way. (b) The `/dashboard` and staff pages read the session cookie themselves in server components; `/dashboard` is now gated by the proxy and staff pages by `requireStaffPage`, but each page was not individually re-audited. (c) About 195 routes authenticate through `verifyRequestSession`; only six representative routes were tested for their unauthorized handling |
| Same-rank account actions | **Open (policy)** | An `admin_manager` can reset or re-email another `admin_manager`, and an `admin` another `admin`, by design of the rank rule. Whether owners are peers is a policy decision |
| Operations-page housekeeping button | **Open (UX / policy)** | Still shown to tenant admins although only the platform operator can run it; the endpoint denies the request safely. Whether to hide it, or expose a tenant-scoped action instead, is undecided |
| Signup gym assignment and multi-gym membership | **Open — decision required** | Self-signup and signup-time invite redemption always land in the primary gym (see §12.2) |
| Global versus per-gym policy | **Open — decision required** | Exercise library, class categories, workout templates, and the `emails` and `readiness-alert` settings have no gym (see §12.2). Nutrition moderation and submissions act on the shared food catalog |
| Per-gym Finance ownership, merchant of record and tax | **Open — decision required** | Platform Finance is interim-restricted to the platform operator (fix 1). The ledger has no gym; revenue attribution, merchant-of-record, tax, Connect, refund and dispute topology are undecided; single Stripe / Revolut / Google Play secrets remain |
| Google Play token first-claim | **Open** | Needs `obfuscatedExternalAccountId` bound at purchase time (client and provider change) |
