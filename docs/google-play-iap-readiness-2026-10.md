# Google Play IAP and App Subscription: readiness reconciliation (2026-10)

**Status:** reconciliation and decision record. Documentation only.
**Base:** `redesign/index-html-blueprint` at `454187f` (PR #58 merged). Evidence date 2026-10-06.
**Mobile repository (read-only):** `sc-coaching-mobile`, `master` at `c94819d`.

This document reconciles the earlier tier-grant / in-app-purchase plan against
the current code and records the owner decisions still required before any
implementation. The plan is a local planning file, `moonlit-riding-alpaca.md`
(dated 2026-09-20), kept outside this repository, so it is **not tracked here**
and is not edited by this change; its items are carried into §2 instead.

**This document is not approval, legal advice, accounting sign-off or provider
confirmation, and it does not authorize implementing anything.** No provider
(Google Play, Apple, Stripe, Revolut, Hostinger) was contacted, and no secrets,
`.env` values, service-account JSON, purchase tokens, `data/db.json` or
production records were read. It makes no claim about which merged PRs are
live on the production host.

## How to read the labels

| Label | Meaning |
|---|---|
| **Confirmed in code** | Read in the cited file at the base commit above. Reading is not running: flows were not executed. |
| **Owner decision required** | A product or business choice nobody has made. Recommendations are never approved decisions. |
| **Legal/accounting approval required** | Needs a professional sign-off this repository cannot supply. |
| **Provider confirmation required** | A statement about Google or Apple behaviour or policy that this document did **not** verify. |
| **Implementation prerequisite** | Must exist before the mobile purchase flow can ship. |
| **Recommended default** | A suggestion only. |

## 1. Readiness summary

| Area | Status |
|---|---|
| Tenant-isolation code work | Release-candidate complete, as recorded in `docs/merchant-of-record-decision-2026-09.md` (PRs #49 to #57). This document does not re-audit it. |
| Server-side Google Play account binding | **Implemented** (PR #52, merge `8d6c0d9`). |
| Delivery of the expected binding to a mobile client | **Not implemented.** No endpoint returns it, and a client cannot compute it. |
| Mobile Google Play purchase flow | **Not implemented.** No billing dependency, no purchase code, no caller of the verify endpoint. |
| End-to-end App Subscription purchase | **Not available.** |
| Tier-grant plan | **Reconciled by this document.** Implementation still needs the owner decisions in §7. |
| Dependency audit | `npm audit --omit=dev` is clean on the base after PR #58 (`source-map-js` 1.2.2). Deployment of that fix is unverified. |
| Production readiness | Still dependent on Hostinger gates, legal and provider approvals, settlement, backup, rollback and two-tenant evidence (see the decision doc). Unchanged by this document. |

## 2. Plan reconciliation

Classification vocabulary: implemented; partially implemented; obsolete; not
implemented; blocked by mobile work; blocked by owner decision; blocked by
provider/legal approval; blocked by staging/infrastructure; requires a
separate PR.

### 2.1 The plan's "already exists" claims

| Plan claim | Status | Where it lives now | Tests | Remaining and next action | Risk |
|---|---|---|---|---|---|
| Three tiers exist: `free`, `app_subscription`, `membership` | Implemented | `lib/member-access.ts:13`; added 2026-08-26 (`194b924`) | Tier suites | None | Low |
| Tier is derived from the package, never stored | Implemented | `resolveMemberTier()`, `lib/membership-entitlement.ts:80-88`: an `app_only` package means App Subscription, any other means Membership, a status other than active or past_due means Free | Entitlement suites | None. It reads the single per-user subscription row (see §5) | Low |
| Mobile Membership screen avoids IAP and hands off to a web checkout | Implemented (mobile repo, read-only) | `sc-coaching-mobile/src/app/membership.tsx` mints a handoff token and opens the browser. Its copy says full checkout is coming to the app | Not examined here | Keep for Membership. Every `Upsell` component routes to this screen | Low |
| Manual tier grant exists but no staff UI calls it | **Obsolete** | The UI now exists: `components/staff/ChangeTierPanel.tsx`, rendered at `app/(staff)/staff/members/[userId]/page.tsx:255`, and the bulk UI in `app/(staff)/staff/members/MembersActivationView.tsx` | API level only | None | Low |
| Lapsed members keep the calendar and are blocked only from new bookings | Implemented (not re-run here) | `noActiveMembership`, `lib/schedule-data.ts:81`; `hasActiveMembership()`, `lib/membership.ts:13` | Existing schedule tests | None | Low |
| "Missing" items: grant UI, lapse step-down, purchase flow | Two of three done | Grant UI and lapse job: see Parts A and B. Purchase flow: see Part C | n/a | Part C | n/a |

### 2.2 Part A: manual and bulk "grant full app access"

| Item | Status | Where and what it does now | Tests | Remaining and next action | Risk |
|---|---|---|---|---|---|
| `members.grantTier` capability, admin and above | Implemented | `lib/permissions.ts:78,111`; used by `app/api/staff/members/[userId]/tier/route.ts` (2026-08-26, `194b924`) | Tier cases in `staff-members-gym-scope`, `archived-actor-routes` | None | Low |
| Single-member "App access" panel | Implemented | `ChangeTierPanel` posts to `POST /api/staff/members/[userId]/tier` | API only | None. See decision 9: a gym admin can grant the platform tier | Medium (policy) |
| Bulk endpoint | Implemented | `app/api/staff/members/bulk-tier/route.ts` (2026-09-22, `a679802`): same-gym members only, per-item results | 32 cases, PR #37 | None | Low |
| Bulk UI | Implemented | `app/(staff)/staff/members/MembersActivationView.tsx`: plan filter, selection, bulk call | None | None | Low |
| "Reuses `grantMemberTier()` exactly as-is" | **Obsolete** | `lib/tier-grant.ts` now stamps and preserves `ownerGym` (PR #51), limits Membership packages to the receiving member's gym, and has **no** cross-scope or provider-token guard | `tier-grant-owner-gym` (9), `tier-grant-invite-gym-scope` (13) | See §5. Separate PR (PR 3) | Medium |

### 2.3 Part B: step lapsed manual memberships down to Free

| Item | Status | Where and what it does now | Tests | Remaining and next action | Risk |
|---|---|---|---|---|---|
| Job drops lapsed manual memberships | Implemented | `lib/jobs/drop-lapsed-manual-memberships.ts` (2026-09-22, `a679802`): 3-day grace, only `provider: "none"`, calls `grantMemberTier(userId, "free")`, notifies via a staff user in the member's own gym | `__tests__/lib/jobs.test.ts`, `__tests__/lib/jobs-gym-scope.test.ts` | None | Low |
| Registered after the lapse-notification job | Implemented | `lib/jobs/registry.ts` | Jobs tests | None | Low |
| Never touches Stripe or Play subscriptions | Implemented as designed | Rows whose provider is not `none` are skipped. A Play subscription is therefore governed only by Play notifications (§5, GP-2 and GP-3) | n/a | Covered by PR 3 and PR 4 | Medium |
| No booking-gate change | Implemented as designed | See §2.1 | n/a | None | Low |
| Auto-restore within 2 days | **Obsolete by design** (not built) | A manual membership has no payment signal. The one-click grant is the mitigation | n/a | None | Low |

### 2.4 Part C: Apple and Google in-app purchase for App Subscription

| Item | Status | Where and what it does now | Tests | Remaining and next action | Risk |
|---|---|---|---|---|---|
| Mobile client: add `react-native-iap` and a config plugin | **Not implemented. Blocked by mobile work and an owner decision** | Absent from `sc-coaching-mobile/package.json` (Expo ~57.0.11, React Native 0.86.2) | None | Library choice and Expo 57 / RN 0.86 compatibility need provider and library confirmation (§7 decision 11, §12). PR 5 | Medium |
| Real paywall screen | **Not implemented. Mobile work** | Today `Upsell` components route to the browser-handoff Membership screen | None | PR 5 | Medium |
| Android verification route: "confirm it has a client caller" | **Implemented on the server, with zero callers (corrected)** | `app/api/mobile/billing/google-play/verify/route.ts` (2026-09-16, `9c66d1d`), hardened by PR #52. A search of the mobile `src` found no reference to it or to any purchase API | 40 cases in 4 files (see §4) | Binding delivery, entitlement guards, hardening: PRs 2 to 4 | High until PRs 2 and 3 land |
| iOS verify route and App Store webhook | **Not implemented. Blocked by owner decision and provider approval** | No routes exist. `BillingProvider` has no Apple value (`lib/db.ts:901`). `apple_iap` is only a catalog label | None | Decision 2. Android first is the recommended default | Medium |
| Console setup, credentials, secrets | **Blocked by provider and legal approval** | The seed script defines one Play product id (from an env variable) and three base plans: `monthly`, `semiannual`, `annual`, at placeholder prices of €12.99, €53.99 and €84.00 | Seed script tests | Real prices and ids must be set in Play Console by the owner; PR 7 | Medium |
| Membership stays on the Stripe web checkout | Implemented, unchanged | Mobile browser handoff. The platform package and its billing options are `visible: false`, and web checkout rejects invisible options | `membership-checkout` suite | **Constraint to keep:** web checkout must never sell the App Subscription | Low |

### 2.5 The plan's remaining sections

| Plan section | Status | Current position |
|---|---|---|
| Multi-tenant guidance (manual grant per gym; never auto-grant App Subscription from a non-IAP payment) | **Partially implemented** | No automatic rule exists. PR #53 blocks the web-checkout cross-scope switch. Manual grants by gym admins remain possible (decision 9) |
| "Files touched": new bulk route, drop job, App Store routes, mobile `src/app/upgrade.tsx` (planned, absent); modified permissions, tier route, member page, members view, registry, mobile `app.json` and `package.json` | Server items done. **App Store routes and all mobile items not done** | See Part C |
| "Explicitly not part of this plan" | Still valid | iOS scope is now an explicit decision (decision 2) |
| "Verification" steps using seeded demo data | **Obsolete** | Replaced by the acceptance criteria in §10 |

## 3. Stale assumptions, corrected

| # | Stale assumption | Current fact | Evidence |
|---|---|---|---|
| 1 | `grantMemberTier` is reused as-is, with no ownership concept | It stamps `ownerGym` once, when a user's subscription row is first created (`platform` for App Subscription), preserves it on every later write, and restricts Membership packages to the receiving member's gym | `lib/tier-grant.ts:29-38,119,171`; PR #51 (`cf4ec27`) |
| 2 | The verify route may already have a mobile caller | It has none | No reference to `billing/google-play` in `sc-coaching-mobile/src` |
| 3 | `react-native-iap` is to be added, or may exist | No IAP or billing dependency exists in the mobile repository | `package.json`, lockfile, `src`, `app.json` |
| 4 | Android has "partial groundwork" and just needs a client | It also lacks any way to hand the expected binding to the client. Only the verify route calls `googlePlayObfuscatedAccountId`, nothing returns it, and it depends on a server secret | `lib/providers/google-play.ts:347`; callers searched in `app` and `lib` |
| 5 | A raw purchase token can be claimed by whichever account submits it first (audit §12.2 and §12.6) | For a token with no owner, the session user's expected binding must match what Google echoes back | PR #52 (`020891a`); `app/api/mobile/billing/google-play/verify/route.ts:146-151` |
| 6 | An App Subscription claim could complete today | None can: a new claim needs a purchase made with the server-derived binding, which no client can obtain | §4 |
| 7 | App Subscription scope was undecided | It is platform-global and IAP-only by current policy. The package is `app_only`, billed through `google_play`, and not visible | Decision doc item 8; seed script; PRs #52, #53, #56 |
| 8 | A member can be moved between gym and platform scope through the web checkout | Blocked in the switch branch only. It is **not** blocked in `grantMemberTier` | PR #53 (`1daf5d8`), `catalogScopesMatch` in `lib/gym-scope.ts` |
| 9 | Any staff member with `catalog.manage` can create an `app_only` package | New `app_only` creation is restricted to `platform_operator`. Editing the existing package is unchanged | PR #56 (`07b4640`) |
| 10 | Membership and App Subscription behave as independent tiers | There is **one subscription row per user** (`saveSubscription` replaces by user id). A Play grant overwrites a Membership row | `lib/db.ts:3243-3254`; §5 |
| 11 | Refund, revocation and acknowledgement are handled by the notification webhook | Not as the code comments imply (GP-3, GP-5) | §5 |
| 12 | The `source-map-js` production advisory is open | Fixed by PR #58, merged at `454187f`. Deployment unverified | Lockfile on the base; `npm audit --omit=dev` |
| 13 | The audit doc records the Play first-claim as open | Corrected in `docs/tenant-boundary-audit-2026-09.md` (§12.7) | This change |

## 4. Current server-side Google Play contract

All of this is **confirmed in code**; none of it was executed.

### 4.1 Verify endpoint

`POST /api/mobile/billing/google-play/verify`, in
`app/api/mobile/billing/google-play/verify/route.ts`.

- **Authentication:** `verifyRequestSession`, so a Bearer token (mobile) or the
  session cookie (web). An archived or deleted account reads as no session.
- **Request:** JSON `{ "purchaseToken": "<string>" }`. No user id, gym id or
  binding field is read from the request. The identity is always the session user.
- **Order of operations:** session; provider configured; request parsed;
  ownership gate; live call to Google; billing-option match; state mapping;
  ownership gate again; binding check (new tokens only); save the purchase
  record; acknowledge if pending; leave if the state is ambiguous; entitlement
  write; revenue event.

| Status | Message | When |
|---|---|---|
| 401 | You must be signed in to verify a purchase. | No valid session |
| 503 | Google Play Billing isn't configured on the server yet. | Provider environment not configured |
| 400 | Invalid JSON body, or A purchase token is required. | Malformed request |
| 409 | This purchase is already linked to another account. | Token recorded for a different account, checked before and after the provider call |
| 400 | Google Play verification failed (status) followed by up to 500 characters of Google's response | Provider rejects or is unreachable. **Not generic**, see GP-9 |
| 400 | This purchase doesn't match a known App Subscription product. | Product id and base plan match no billing option |
| 409 | This purchase could not be verified for your account. | New token whose binding is missing, malformed or mismatched. One message on purpose |
| 409 | Your purchase is still being processed by Google Play. Try again shortly. | Pending or unspecified state: the record is saved, no entitlement is granted |
| 500 | The entitlement-write failure message | `grantMemberTier` failed |
| 200 | Purchase verified, with the resulting tier and status | Success |

### 4.2 Account binding

- **Derivation (server only):** hex HMAC-SHA256, keyed with the session secret, over the fixed prefix
  `google-play-obfuscated-account-id:v1:` followed by the user id
  (`lib/providers/google-play.ts:337-351`). It is deterministic, not reversible
  without the secret, and 64 hex characters long. It reuses `SESSION_SECRET` on purpose
  (see GP-12). It returns nothing if the secret is not configured, and callers
  must then refuse.
- **Comparison:** Google echoes the value as
  `externalAccountIdentifiers.obfuscatedExternalAccountId` on the verified
  subscription. The server compares it in constant time (`googlePlayAccountBindingMatches`).
  A missing, empty or different-length value is simply "not a match".
- **When it applies:** only to a token with **no existing owner**.
- **Not implemented:** nothing delivers the expected value to a client.

### 4.3 Ownership and idempotency

- **Same owner:** a token already recorded for the session user is idempotent. It is re-verified, re-saved and
  re-granted without resending a binding, which supports "restore purchases".
  Revenue is recorded once per Google order id.
- **Different owner:** rejected with 409 before the provider call and again after it.
  The recorded owner and entitlement are never touched.
- **First claim:** the recheck, binding check and save contain no await, so two concurrent
  first claims cannot both succeed in a single Node process.

### 4.4 Provider state mapping (shared by verify and RTDN)

| Google subscription state | Stored Play status | App subscription status |
|---|---|---|
| ACTIVE | active | active |
| IN_GRACE_PERIOD | in_grace_period | past_due (access kept) |
| ON_HOLD | on_hold | canceled |
| PAUSED | paused | paused |
| CANCELED | canceled | active while the paid period has not ended, otherwise canceled |
| EXPIRED | expired | canceled |
| Pending, unspecified or unknown | canceled | none: nothing is granted |

### 4.5 RTDN webhook

`POST /api/webhooks/google-play?token=...`, in `app/api/webhooks/google-play/route.ts`.

- **Authentication:** a shared secret in the URL, compared in constant time. This is
  deliberately not Pub/Sub OIDC verification (see GP-7).
- **Handling:** a missing or wrong token returns 401. A test notification, an unparseable
  payload or one without a purchase token returns 200 and is ignored.
  **A token with no stored record returns 200 and is ignored**, so a notification can never create a claim.
  For a known token it re-verifies with Google (502 on failure, so Pub/Sub retries),
  updates the purchase record (the stored binding is preserved, never overwritten),
  and, unless the state is ambiguous, calls `grantMemberTier` for the **stored owner**.
  It records revenue once per order id.
- **The notification type is never trusted.** It is only a prompt to re-check.

### 4.6 Records and ownership

| Record | Behaviour |
|---|---|
| `GooglePlayPurchaseRecord` | `userId` is a required string. Holds the token, product, base plan, order id, linked token, status, acknowledgement, auto-renew, start and expiry, and the echoed binding (an opaque hash, stored for audit). It has no `ownerGym`: it is platform by construction |
| `SubscriptionRecord` | One row per user. A Play grant sets provider `google_play`, the purchase token as the provider subscription id, the period end, the mapped status and the billing option. `ownerGym` is `platform` when the row is first created for App Subscription and is **preserved unchanged** thereafter, even if the package later changes scope (PR #51; undecided question recorded in `lib/db.ts`) |
| `RevenueEventRecord` | Provider `google_play`, provider reference = Google order id, source `membership_renewal`, `ownerGym` always `platform` (PR #55). The amount is the billing option's **configured** price, a placeholder (see GP-4) |

### 4.7 Logging and tests

- **Logging:** the four Play files make **no logging calls**. The purchase token, the binding and
  provider responses are never logged by this code.
- **Tests:** 40 cases in 4 files (12 verify binding, 13 verify ownership, 3 webhook binding, 12
  derivation). They mock the provider. **No test covers** a notified token that
  is not the row's current subscription, a Membership holder buying, refunds, acknowledgement
  failure, or timeouts.

### 4.8 Missing today

No mobile caller; no endpoint delivering the binding; no kill switch; no
refund, void or revocation handling; no acknowledgement retry outside the verify
route; no timeout on any Google call; no iOS handling of any kind.

## 5. Findings that gate implementation

| ID | Finding | Severity | Confidence | Addressed by |
|---|---|---|---|---|
| GP-1 | **No way to deliver the binding to a client.** A client cannot compute it. A new authenticated endpoint is an implementation prerequisite | Blocker | High | PR 2 |
| GP-2a | **Membership conflict.** One subscription row per user. A Play purchase by a gym Membership holder replaces that row with the platform package. If the existing provider is Stripe, `grantMemberTier` also cancels the live Stripe subscription (it does so whichever tier is being granted). `ownerGym` then stays the gym while the package is platform. PR #53 closed this only on the web-checkout path | High, latent until the first purchase | High (code reading, not executed) | PR 3, decision 1 |
| GP-2b | **A superseded or stale token can overwrite the current row.** The webhook calls `grantMemberTier` for a known token's owner without checking that the token is the row's current Play subscription. If staff moved the user to Membership or Free, a later renewal or expiry for the old token would overwrite that. Staff downgrades cancel only Stripe, so Play billing would continue. A guard must compare the provider and the token, not the token alone | High, latent | High (not executed) | PR 3 |
| GP-3 | **No refund, chargeback or void handling.** The notification parser reads only subscription notifications. There is no revenue reversal, and `RevenueSource` has only `membership_renewal` | Medium | High that it is absent. How Google reports revoked subscriptions: provider confirmation required | PR 4 |
| GP-4 | **Revenue is the configured placeholder price,** not the charged or net amount. Regional pricing, tax and Google's fee are ignored, so the platform-operator-only Finance page would misstate Play revenue | Medium | High | Decision 3, PR 4 |
| GP-5 | **Acknowledgement is never retried by the webhook.** A code comment in the verify route says it is. Unacknowledged purchases are refunded by Google after a deadline the code comments give as 3 days | Medium | High; deadline: provider confirmation required | PR 4 |
| GP-6 | **Hard delete removes a member's stored Play purchase, but nothing cancels the subscription at Google.** There is no Play cancellation helper. Billing would continue and later notifications would be ignored as unlinked | Medium, policy | High | Decision 6 |
| GP-7 | **RTDN authenticates with a token in the URL,** which can appear in logs. Impact is limited because the handler only re-verifies known tokens | Low | High | PR 4 (optional) |
| GP-8 | **No timeout on any Google or OAuth call.** A stalled upstream can hang the verify route or the webhook | Low to Medium | High | PR 4 |
| GP-9 | **The verify route forwards up to 500 characters of Google's response body** to the client in a 400. Only the binding failure is generic | Low | High | PR 4 |
| GP-10 | If an existing purchase record had an empty owner, the binding check would be skipped. No code path creates one and the type requires an owner | Info | Medium | PR 3 (defence in depth) |
| GP-11 | **No kill switch.** Unsetting the provider configuration returns 503 from verify, but the webhook would fail with 502 and trigger Pub/Sub retries | Blocker for rollout | High | PR 2, decision 10 |
| GP-12 | **`SESSION_SECRET` is used for both sessions and the binding.** Rotating it logs everyone out and changes every user's expected binding, which breaks any purchase made but not yet verified | Medium (operations) | High | Document in PR 1, handle in PR 2 |

## 6. Tier-grant and entitlement model

- **Whose entitlement is it:** user-owned. Tier is derived from the user's one subscription row. The package
  it points at is either platform-global (App Subscription) or gym-owned (Membership).
  `ownerGym` is immutable provenance for money attribution, **not** an access control.
  Staff access uses the current `user.gymId` and `sameGym`.
- **App Subscription scope:** platform-global and IAP-only by current policy (decision doc item 8).
  Whether that is permanent is decision 8.
- **Cross-gym grants:** staff grants of Membership are limited to the receiving member's gym. Staff
  grants of App Subscription are not gym-limited because the package is platform-wide.
- **Does a future gym change move entitlements?** Stored `ownerGym` snapshots do not move. An
  App Subscription entitlement does not depend on the user's gym. A Membership entitlement keeps
  pointing at the old gym's package. No code path reassigns an existing user's gym today; only
  gym signup sets it. Multi-gym membership is out of scope (decision doc item 9).
- **Schema:** the base Play flow needs none. Coexisting Membership and App Subscription would need a
  data-model change (two rows per user, or a new relationship). Refund reversals would need a new revenue
  source or event kind. iOS would need a new provider value. Each needs separate approval.
- **Backfill:** none for Play, since no Play records are expected to exist (production not inspected).
  The existing `ownerGym` backfill scripts remain report-only; running any with `--confirm` needs separate approval.
- **Manual grants of the platform tier:** three paths, all free of charge to the member and all gym-admin accessible: the
  tier route, the bulk route, and invitations (`POST /api/staff/invites` accepts `app_subscription`;
  redemption calls `grantMemberTier`). See decision 9.

## 7. Owner decisions

As written on 2026-10-06, nothing below was decided; "Recommended default" is a suggestion.
**Update 2026-10-07:** the owner supplied defaults that settle decisions 1 (reject), 2
(Android first), 7 (no automatic reassignment) and 10 (a kill switch that defaults off). They
are recorded, with the interpretations made where they leave a gap, in
`docs/iap-multitenant-implementation-plan-2026-10.md` §1 and §2. Every other decision remains open.

| # | Decision | Options | Recommended default (not approved) | Label | Gates |
|---|---|---|---|---|---|
| 1 | An active gym Membership holder tries to buy App Subscription | Reject until the Membership ends, or support coexistence (schema and entitlement redesign) | Reject, with a clear message, on the server and by hiding the paywall | Owner decision required | PR 3, PR 5 |
| 2 | Android only, or also iOS | Android first, or both | Android only for the first release. iOS needs separate provider and App Store work and an Apple verify route and webhook that do not exist | Owner decision required; provider confirmation required | PR 5 |
| 3 | Revenue basis for Play | Gross charged, net of Google's fee, or tax-exclusive. Also the source of truth and reconciliation method | None proposed: depends on accounting treatment | Owner decision required; legal/accounting approval required; provider confirmation required | PR 4, PR 8 |
| 4 | App Subscription merchant and account ownership | Which entity owns the Play developer and payments profile | None proposed | Owner decision required; legal/accounting approval required; provider confirmation required | PR 7 |
| 5 | Refund and revocation responsibility | Who handles requests, and whether access is cut immediately | None proposed | Owner decision required; provider confirmation required | PR 4 |
| 6 | Account deletion with an active App Subscription | Block deletion, warn and require cancelling in Play, or accept orphaned billing | Warn clearly and link to Play subscription management | Owner decision required; provider confirmation required | PR 4, PR 5 |
| 7 | Account transfer | Never, or a support-assisted process | No transfers: the binding ties a purchase to one app account | Owner decision required | PR 3 |
| 8 | Is App Subscription permanently platform-global | Permanent, or revisit if Connect or multi-gym membership is approved | Stay platform-global until a separate approved change | Owner decision required | Informational |
| 9 | May gym admins grant the platform tier manually | Yes, no, or only the platform operator | Unclear. The current behaviour is yes, free of charge, through three routes. This is a revenue and AI-cost question | Owner decision required | PR 3 or later |
| 10 | Kill switch and rollout controls | Server flag semantics, defaults, who can flip it, the staged rollout percentages | A server-side flag that fails closed and disables the paywall and verification in one request | Owner decision required; implementation prerequisite | PR 2, PR 8 |
| 11 | Billing library | A direct Play Billing wrapper, or a managed service (adds a third-party processor and changes the verify contract) | Evaluate direct wrappers first, because the server verifies raw purchase tokens | Owner decision required; provider confirmation required | PR 5 |
| 12 | Staging environment for testing | Build or designate one | Required before internal testing. None is evidenced | Implementation prerequisite | PR 7 |

## 8. Cross-repository mobile plan (not started; `sc-coaching-mobile` is not modified)

**The mobile flow must not ship before PRs 2 to 4 and their tests are complete.**

- **Repository facts (read-only):** Expo ~57.0.11, React Native 0.86.2, Android package
  `com.sandcperformancecoaching.app`, `app.json` shows `versionCode` 69, and plugins include
  `expo-secure-store` and `expo-notifications`. EAS build profiles are `development` (development client),
  `preview`, `apkpure` and `production`; the submit profile has both `ios` and `android` entries.
  Session tokens are kept with `expo-secure-store` (`src/lib/token-store.ts`), and logout is in `src/lib/auth-context.tsx`.
- **Working-tree note:** the mobile repository has a pre-existing uncommitted change to `eas.json` (+3 lines).
  It was not read or modified. It must be reviewed on its own and **must not be swept into the IAP work**.
- **Dependency and compatibility:** choose a library, then verify its compatibility with Expo SDK 57 and React Native 0.86
  *(provider and library confirmation required; not verified here)*. A native billing module needs a **development build**,
  not Expo Go. The existing `development` profile already sets `developmentClient`.
- **Play Console:** a subscription product whose id matches the server's configured product id, with the base plans
  `monthly`, `semiannual` and `annual`. Real prices are set there and shown from Play, never from the seed placeholders.
  Grace and hold settings affect the status mapping in §4.4. Pub/Sub topic and push URL for RTDN, and service-account permission.
- **Authenticated binding:** the app asks the future endpoint (PR 2) for the session user's own binding and passes
  it to `setObfuscatedAccountId()` **before** launching the purchase. The allowed length and characters, and whether Play retains the value across resubscription,
  are *provider confirmation required*.
- **Token submission:** `POST` the purchase token to the verify endpoint. Map 409 (owned by another, binding mismatch),
  409 (still processing), 400 (unknown product), 503 and 401 to distinct, non-looping user messages.
- **States:** pending (grant nothing, poll with capped backoff); restored (query owned purchases and submit them; same account is idempotent,
  a different account gets a clear message); cancelled (no change); failed (no change); duplicate or replayed (dedupe by token).
- **Secure pending-token storage:** if the server cannot be reached after a purchase, persist the token in secure storage and retry,
  because unacknowledged purchases are refunded after a deadline. Tokens are never logged or placed in analytics.
- **Foreground refresh:** re-read the tier on app foreground so server-side refund, expiry and grace changes show up.
- **Logout and account switching:** a purchase belongs to the Google account, and the binding prevents claiming it under another app account.
  Clear cached products and pending state on logout, and do not retry-loop a binding rejection.
- **Acknowledgement:** done client-side as the primary path and server-side as a retry (PR 4). Deadline: provider confirmation required.
- **Install source:** the `apkpure` profile produces builds not installed from Play. Hide the paywall where Play Billing is unavailable.
  Sideloaded builds cannot purchase.
- **Disclosures:** update the Play Data Safety form and the privacy policy (see `docs/privacy-policy-audit-2026-08.md` §8, which predates this work and
  must be re-checked), declare Play purchases, and add the subscription terms and renewal disclosures Play requires
  *(provider confirmation required)*. `sc-coaching-mobile/docs/play-store-submission.md` currently describes purchases as Stripe-processed real-world services only.
- **Testing and rollout:** internal testing track with license testers, then a staged rollout. Play cannot downgrade installed apps, so a
  server kill switch (PR 2) is the primary rollback.

## 9. Proposed follow-up PRs (none created by this change)

PR 0 (`#58`, lockfile security fix) is merged. PR 1 is this document.

### PR 2: server prerequisites and binding delivery (`gym-app`)
- **Files likely:** a new `app/api/mobile/billing/google-play/` endpoint returning only the session user's own binding; kill-switch
  helper and checks in the verify route and the webhook; tests.
- **Schema / migration:** none.
- **Security risk:** medium. The endpoint must take no user or gym parameter, reject archived and deleted actors, be rate limited and never log the value.
  The kill switch must fail closed.
- **Test plan:** synthetic: own value only, no parameter honoured, 401 cases, kill switch on and off, existing 12 derivation cases unchanged.
- **Rollback:** revert. No data is written.
- **Approvals:** decision 10.
- **Real money / production:** none. It deploys to production but is inert until a client calls it.

### PR 3: Membership conflict and stale-token guards (`gym-app`)
- **Files likely:** `lib/tier-grant.ts` or a new guard module, the verify route, the webhook, tests.
- **Schema / migration:** none if the policy is "reject". A coexistence policy needs a separately approved design.
- **Security risk:** high value: it changes entitlement writes. Manual, staff and invite grants must not change. A stale token must be a no-op; the guard compares provider and token.
  A rejected conflict must not cancel Stripe.
- **Test plan:** characterization tests first (to pin current behaviour), then a matrix: Membership holder, Free, expired Play, stale token, staff-moved user. `ownerGym` preserved.
- **Rollback:** revert.
- **Approvals:** decisions 1, 7 and 9.
- **Real money / production:** none.

### PR 4: acknowledgement retry, timeouts, refund and revocation (`gym-app`)
- **Files likely:** `lib/providers/google-play.ts` (timeouts, sanitized errors), the webhook (acknowledgement retry, void handling if confirmed), `lib/db.ts` types if a reversal event is approved, tests.
- **Schema / migration:** possibly an additive type change. No migration of existing data. Any backfill needs separate approval.
- **Security risk:** medium. Provider error text must not reach the client. No token logging. OIDC verification only if testable.
- **Test plan:** synthetic provider responses, fake timers for timeouts, refund fixtures clearly labelled synthetic.
- **Rollback:** revert. The type change is additive.
- **Approvals:** decisions 3, 5 and 6; provider confirmation of revocation and void semantics.
- **Real money / production:** none until rollout. Reversal logic affects Finance figures.

### PR 5: mobile purchase flow (`sc-coaching-mobile`)
- **Files likely:** `package.json` and lockfile, `app.json` plugins, a new billing module, a new `src/app/upgrade.tsx` (does not exist yet), `src/components/ui/Upsell.tsx`, the membership query, privacy copy. A native change needs a new development build.
- **Schema / migration:** none.
- **Security risk:** medium to high. Tokens stay in memory or secure storage and are never logged. The binding is fetched per session. The paywall depends on server-reported tier and install source. It ships dark.
- **Test plan:** unit tests for the purchase state machine, then Android testing on the internal track with license testers.
- **Rollback:** the server kill switch, halting the staged rollout, then a hotfix build.
- **Approvals:** decisions 1, 2, 6 and 11; review of the pre-existing `eas.json` change.
- **Real money / production:** license-tester purchases are not charged *(provider confirmation required)*. Production data must not be used.

### PR 6: server and mobile integration tests (both repositories)
- **Files likely:** contract tests in `gym-app` using synthetic provider fixtures, and a mobile test harness.
- **Schema / migration:** none. **Security risk:** low.
- **Test plan:** the scenarios in the acceptance criteria (§10). **Rollback:** revert.
- **Approvals:** none. **Real money / production:** none.

### PR 7: internal Play testing (no code; Play Console and EAS)
- **Files likely:** evidence notes only.
- **Schema / migration:** none. **Security risk:** test accounts only, and a **staging environment** is required, because none is evidenced.
- **Test plan:** purchase, restore, cancel, refund, account switch and an RTDN round trip. **Rollback:** disable the test track.
- **Approvals:** owner access to Play Console; decisions 4 and 12.
- **Real money / production:** none, and production data must not be used.

### PR 8: staged production rollout and reconciliation (operations, plus a runbook)
- **Files likely:** a runbook, and optionally a reconciliation script (dry run first, report only by default).
- **Schema / migration:** none unless decision 3 requires it. **Security risk:** high: real users and real money.
- **Test plan:** staged percentages, each gated on error rates and on reconciling recorded revenue against Play's own reports.
- **Rollback:** kill switch, halt the rollout, hotfix build, revert any server PR. Purchases already made stay with Google and need a reconciliation process and a refund policy.
- **Approvals:** owner; legal and accounting; provider.
- **Real money / production:** **yes**, both, performed by an authorized operator only.

## 10. Acceptance criteria

1. The binding endpoint returns only the caller's own value and nothing else, and takes no user or gym parameter.
2. A new token without a matching binding is refused with the generic response.
3. A token owned by another account is refused, and the recorded owner is never changed.
4. Repeating a verify for the same account is idempotent.
5. A Membership holder's purchase is refused with a clear message, or the approved coexistence model is implemented and tested.
6. A notification for a token that is not the row's current Play subscription cannot overwrite the row.
7. Refund, revocation, expiry, hold, pause and grace each produce the documented tier. Duplicate and out-of-order notifications are harmless.
8. Revenue is recorded once per order, on the approved basis, and reversed on refund.
9. Every purchase is acknowledged within Google's deadline, with a retry path.
10. The kill switch disables the paywall and verification within one request and fails closed.
11. No token, binding or personal data appears in logs, error responses or test output.
12. Web checkout can never sell the App Subscription.
13. The Data Safety form, privacy policy and subscription disclosures are updated before release.
14. Purchase, restore, cancel, refund and account-switch scenarios pass on the internal track.
15. Reconciliation of recorded revenue against Play's reports is demonstrated before any widening of the rollout.

## 11. Production rollout and rollback requirements

- **Before rollout:** a tested backup and restore of the datastore (the decision doc records that rollback has never been exercised);
  a staging environment; the Hostinger runtime gates in `docs/deployment-operations.md` and the decision doc;
  verification of `TRUSTED_PROXY_HOPS` if rate limiting is to be trusted; the kill switch deployed and tested.
- **Rollout:** staged percentages, each step gated on the verify error rate, RTDN failures, the binding-rejection rate,
  and recorded revenue reconciled against Play's own reports.
- **Rollback order:** kill switch, then halt the staged rollout, then a hotfix build, then revert any server PR.
- **What cannot be rolled back:** purchases already made stay with Google. The only remedy is a reconciliation process (dry run first) and an agreed refund policy.
- **Secrets:** the provider service account, the notification token and the session secret are managed by the owner.
  Rotating the session secret has purchase consequences (GP-12).

## 12. Not verified by this document

Each of these needs provider documentation or confirmation before it is relied on:

- Play Billing library version requirements, and library compatibility with Expo SDK 57 and React Native 0.86.
- The allowed length and characters of the obfuscated account id, and whether it is retained across resubscription.
- How Google reports refunds, revocations and voids for subscriptions, and which notification types fire.
- The acknowledgement deadline (the repository's code comments say 3 days), and availability of pending purchases for subscriptions.
- Merchant-of-record and tax responsibilities for Play sales in each market.
- Play's requirements on account deletion, subscription disclosures and payments policy, and Apple's rules if iOS is included.

## 13. Related documents

- `docs/tenant-boundary-audit-2026-09.md` (§12.7 added by this change)
- `docs/merchant-of-record-decision-2026-09.md`
- `docs/payments-architecture.md` (App Subscription pointer added by this change)
- `docs/membership-switching.md`
- `docs/deployment-operations.md`
- `docs/privacy-policy-audit-2026-08.md` (predates this work; re-check §8 before any submission)

## 14. Update 2026-10-07: implementation status of the findings

Implementation of the owner defaults is in the stack described in `docs/iap-implementation-status-2026-10.md` (gym-app PRs
#60 to #63 plus this one, and `sc-coaching-mobile#11`). **Nothing is merged or deployed, and nothing has run against Google.**
Every row below is "tested with a fake provider" at most. The contract is `docs/google-play-server-contract-2026-10.md`.

| ID | Status after the stack |
|---|---|
| GP-1 | Implemented: `GET /api/mobile/billing/google-play/purchase-context`. Mobile consumption is in `sc-coaching-mobile#11`, not enabled |
| GP-2a | Implemented and tested: conflict rules at every synchronous entry point (PR #62) and on the claim path (PR #63). A Stripe or Revolut completion can no longer overwrite a live Play entitlement (cross-provider guard, see the schema document section 7). **Moving a paying member between providers deliberately is a follow-up: no transition API exists** |
| GP-2b | Implemented and tested: a stale token cannot overwrite the row; a successor token can take over |
| GP-3 | Implemented and tested for a voided current order. **Payload shapes and refund semantics need real-provider verification.** Revenue reversal is **not implemented** (accounting decision) |
| GP-4 | Open. Revenue is still the configured placeholder price |
| GP-5 | Implemented and tested: acknowledgement retry job with interval, attempt cap and window. The three-day window needs provider confirmation |
| GP-6 | Open (decision 6) |
| GP-7 | Not changed |
| GP-8 | Implemented and tested: 10 s timeout on every Google call |
| GP-9 | Implemented and tested: no provider text reaches a caller |
| GP-10 | Implemented: a claim is always created through the atomic helper with an owner |
| GP-11 | Implemented and tested: kill switch, default off, gating new claims only |
| GP-12 | Documented in the runbook (section 7); not changed |
