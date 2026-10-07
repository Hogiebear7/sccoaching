# Multi-tenant and Google Play App Subscription: implementation plan and owner defaults (2026-10-07)

**Status:** plan, written **before** any implementation code. Documentation only.
**Base:** `redesign/index-html-blueprint` at `a6a27fa` (PR #59 merged).
**Source of truth for the readiness analysis:** `docs/google-play-iap-readiness-2026-10.md`.

This document records (1) the product defaults the owner supplied on 2026-10-07 and how
they resolve the decisions listed in the readiness document, (2) the interpretations this
plan had to make where those defaults leave a gap, (3) how the plan adapts to this
repository's actual architecture, and (4) the phase checklist and PR sequence. It is not
legal, accounting or provider confirmation. Nothing in it is implemented by this PR.

## 1. Owner-provided defaults (2026-10-07)

| # | Default | Resolves readiness decision |
|---|---|---|
| D1 | A user with an **active gym Membership cannot purchase or activate an App Subscription.** The claim is rejected with a stable, non-sensitive error. No pending purchase intent is created. A claim is possible only once the Membership is no longer active | 1 (Membership conflict): **reject** |
| D2 | **No automatic conversion** between Membership and App Subscription. No entitlement overlap. Historical records and audit events are preserved. Nothing is automatically cancelled or refunded | 1, 7 |
| D3 | **First valid account binding wins.** A token bound to another account is rejected and never reassigned automatically. Duplicate submissions by the same account are idempotent. A missing, malformed or mismatched binding is rejected. The backend is authoritative | 7 (no automatic transfer) |
| D4 | Android sets `obfuscatedAccountId` before purchase, using a one-way identifier (never cleartext PII). The backend verifies the token and validates package, product and account context | GP-1 |
| D5 | Entitlement is granted **only after server verification**. Access continues through the paid expiry after ordinary cancellation. Grace period, account hold, expiry, refund, revocation and acknowledgement failure are handled explicitly. Transitions are idempotent and auditable | 5 |
| D6 | **Android and Google Play first.** iOS is a separate future provider and is not pretended to exist. The system stays provider-neutral where practical | 2: **Android only** |
| D7 | A **kill switch** exists and defaults **off**. Staging and test configuration is explicit. No production behaviour is enabled | 10 |
| D8 | Revenue recognition is **not invented.** Only technical entitlement state is implemented; accounting policy is documented as an owner and accounting follow-up | 3 stays open |

Decisions the defaults do **not** settle and that remain open: 4 (merchant and account
ownership), 5 (refund and revocation *responsibility*), 6 (account deletion with an active
subscription), 8 (permanence of platform-global scope), 9 (whether gym admins may grant the
platform tier manually), 11 (billing library), 12 (staging environment), and the whole of
revenue recognition (3). They stay labelled **owner decision required** in the readiness
document.

## 2. Interpretations made (owner to confirm)

The defaults leave these gaps. The plan takes the **most conservative** reading and flags it.

| # | Gap | Interpretation used |
|---|---|---|
| I1 | "A later Membership activation cannot silently create overlapping access" | A Membership activation (staff grant, admin activation, web checkout) over a **live** App Subscription is rejected with a stable error. Staff can end a manually granted App Subscription first, then grant the Membership. Two explicit steps, never one automatic one |
| I2 | An App Subscription billed through Google Play cannot be ended by staff | A staff downgrade or conversion of a **live Google Play** entitlement is rejected with a stable error. The member cancels in Google Play and the entitlement ends at the paid expiry. This closes the stale-token and orphaned-billing hazards (readiness GP-2b) without cancelling anything automatically |
| I3 | "Active gym Membership" | A Membership-scope subscription whose status is `active`, `past_due` or `paused`, and whose paid period has not lapsed. `pending`, `inactive`, `canceled` and a lapsed `active` row are **not** active |
| I4 | "Cancelled but active" | For a Membership this is an `active` row whose period has not ended, so it counts as active. For Google Play it is the CANCELED state with a future expiry, which keeps access until that expiry |
| I5 | A Play claim rejected for a Membership conflict | The purchase is **not acknowledged.** Google refunds an unacknowledged purchase after its deadline (the code comments say 3 days; provider confirmation required). Nothing is cancelled or refunded by this app |
| I6 | Lifecycle events for an already-claimed purchase when the kill switch is off | Revocation, expiry and refund processing **continues**: a kill switch must not stop access being withdrawn. The switch gates **new claims and the purchase context** |
| I7 | Manual (provider `none`) App Subscription grants by gym admins | Unchanged by this plan (decision 9 stays open), except that they now obey the conflict rules above |

## 3. How the plan fits this repository

This repository is **not** SQL-backed and is not multi-gym-per-user. The plan adapts the
requested "migrations, constraints and transactions" to what exists:

- **Datastore:** one JSON file with synchronous read and write, in one persistent Node
  process (`docs/launch-checklist.md` §6). A "transaction" is a single read-modify-write
  inside one synchronous function. A "unique constraint" is enforced inside a datastore
  helper that checks and inserts in the same call. Both are tested.
- **Schema changes:** additive and optional. New fields default on read, so existing files
  load unchanged (the established pattern in `readDb`). No destructive migration.
  A dry-run-first backfill script is provided for derived fields, following the existing
  `scripts/backfill-*` pattern.
- **Tenant model:** a user has exactly **one** gym (`gymId`, null = the primary gym). "Same
  user in two tenants" is therefore not representable. The plan tests that the verified
  tenant context cannot be switched by a client-supplied selector instead.
- **Entitlement ownership:** user-owned (one `SubscriptionRecord` per user). The App
  Subscription package is platform-global. `ownerGym` is immutable provenance, not an access
  control.
- **Tests:** vitest with a mocked datastore for unit tests, plus an **end-to-end harness**
  that runs the real route handlers against a real datastore file in a temporary directory
  (`DATA_DIR` is read once at module load) with a fake Google Play adapter. Fake tokens and
  mocked provider responses only.
- **Not available here:** a real Google Play connection, a device or emulator, Apple, and a
  staging environment. Those are listed as requiring verification, never as done.

## 4. Phase checklist

Status values: **planned**, **in progress**, **done (mocked)**. Nothing is "production ready".

| Phase | Work | PR | Status |
|---|---|---|---|
| A | Architecture and inventory: auth and session flow, tenant and role resolution, tenant-owned collections, subscription and payment records, jobs, webhooks, caches, admin paths | PR 2, this doc | in progress |
| B | A single verified tenant context, explicit authorization helpers, a classification of every route and collection with a drift guard, cache classification | PR 2 | planned |
| C | Additive schema: purchase token hash, first-binding record, entitlement and acknowledgement state, snapshot ordering, an append-only audit event log, notification idempotency; atomic datastore helpers; backfill script | PR 3 | planned |
| D | Provider-neutral adapter with a Google implementation (timeouts, sanitized errors), a fake adapter, the verify service, RTDN processing, acknowledgement retry, reconciliation job, kill switch | PR 4 | planned |
| E | Membership conflict enforced at **every** entry point: Play claim, purchase context, grant, admin activation, staff override, web checkout, RTDN activation | PR 3 (rules and sync entry points), PR 4 (provider paths) | planned |
| F | Android purchase flow in `sc-coaching-mobile`, separate branch and PR | PR 5 | planned |
| G | Tests: tenant isolation, entitlement lifecycle, mobile | each PR, harness in PR 6 | planned |
| H | Documentation: tenant context, scope classification, policy, contract, state machine, RTDN, acknowledgement, kill switch, runbook, final status | PR 6 | planned |

## 5. PR sequence and branching

| PR | Repository | Branch | Base | Depends on |
|---|---|---|---|---|
| 1 | gym-app | `docs/iap-multitenant-plan-and-owner-defaults` | `redesign/index-html-blueprint` | none |
| 2 | gym-app | `feat/tenant-context-and-route-scope-guard` | `redesign/index-html-blueprint` | none |
| 3 | gym-app | `feat/iap-entitlement-schema-and-membership-conflict` | `redesign/index-html-blueprint` | none |
| 4 | gym-app | `feat/google-play-provider-and-lifecycle` | PR 3's branch (stacked) | PR 3 |
| 5 | sc-coaching-mobile | `feat/android-play-billing-flow` | `master` | the PR 4 server contract (not its code) |
| 6 | gym-app | `feat/iap-e2e-harness-and-runbook` | PR 4's branch (stacked) | PR 4 |

Stacked PRs target their parent branch so each diff stays reviewable. When the parent
merges, the child's base must be retargeted to `redesign/index-html-blueprint`. **No PR is
merged and nothing is deployed by this work.**

## 6. Test matrix

| Area | Cases | Where |
|---|---|---|
| Tenant isolation | two users in different gyms; wrong tenant selector; guessed resource id; cross-tenant update and delete; role escalation; admin and operator paths; background job; webhook; cache key reuse; request-context reuse; error non-disclosure. "Same user in two tenants" is asserted as **not representable** | PR 2, PR 4, PR 6 |
| Entitlement | Membership conflict (active, past due, paused, pending, expired, lapsed, absent, cancelled-but-active); duplicate claim; conflicting token claim; missing, malformed and mismatched binding; invalid product; provider timeout; acknowledgement retry; refund; revocation; cancellation; grace; hold; expiry; duplicate and out-of-order RTDN; replay; kill switch; no entitlement before verification | PR 3, PR 4, PR 6 |
| Mobile | correct `obfuscatedAccountId`; success; pending; cancelled; already owned; backend rejection; restore; server entitlement delay | PR 5 |

## 6.1 Boundaries restated

Nothing deployed or merged. No production configuration. No `.env` values, service-account
JSON, tokens or `data/db.json` read. No provider contacted. No real purchase tokens. No
destructive data change. `sc-coaching-mobile/eas.json` (its pre-existing uncommitted change)
is not touched or included.
