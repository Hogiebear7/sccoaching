# Multi-tenant authorization and Google Play App Subscription: implementation status (2026-10-07)

**This is not a production-readiness statement.** Local tests passing does not make the system ready. Every item below
carries exactly one of five labels, and the large majority are **tested with mocks or fakes only**.

Base `redesign/index-html-blueprint` at `a6a27fa`. Nothing here is merged or deployed. No provider was contacted, no
production data, secret, `.env` value or `data/db.json` was read, and no real purchase token was used.

## 1. The stack

Merge in this order. After each parent merges, retarget the next PR to `redesign/index-html-blueprint`.

| PR | Repository | Branch | Base | Content |
|---|---|---|---|---|
| [#60](https://github.com/Hogiebear7/sccoaching/pull/60) | gym-app | `docs/iap-multitenant-plan-and-owner-defaults` | base | Plan, owner defaults, interpretations I1 to I7 (docs only) |
| [#61](https://github.com/Hogiebear7/sccoaching/pull/61) | gym-app | `feat/tenant-context-and-route-scope-guard` | base | Tenant context, route and collection scope registries, drift guards |
| [#62](https://github.com/Hogiebear7/sccoaching/pull/62) | gym-app | `feat/iap-entitlement-schema-and-membership-conflict` | #61 | Additive schema, atomic helpers, Membership conflict enforcement, backfill |
| [#63](https://github.com/Hogiebear7/sccoaching/pull/63) | gym-app | `feat/google-play-provider-and-lifecycle` | #62 | Adapter, claim and lifecycle service, kill switch, jobs, contract doc |
| [sc-coaching-mobile#11](https://github.com/Hogiebear7/sc-coaching-mobile/pull/11) | sc-coaching-mobile | `feat/android-play-billing-flow` | `master` | Android purchase flow (library-agnostic, not enabled) |
| this PR | gym-app | `feat/iap-e2e-harness-and-runbook` | #63 | End-to-end journeys, report script, runbook, this status, one regression fix |

The plan listed PR 3 as independent of PR 2. It is stacked instead, because the collection registry added in PR 2 is typed
against every datastore collection, so a PR that adds a collection must build on it.

## 2. Status labels

1. **Implemented**: code exists in the stack.
2. **Tested with mocks**: covered by tests that use a fake provider, a mocked datastore or a temporary datastore file.
3. **Requires staging**: needs a deployed environment that does not exist here.
4. **Requires real-provider test-track verification**: needs Google Play, a Play licence tester and the internal test track.
5. **Requires production approval**: an owner or compliance decision, or an action on production.

## 3. What exists

| Capability | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Verified tenant context; route manifest (227) and collection registry (72) with drift guards | yes | yes | | | |
| Additive schema: purchase token hash, binding time, acknowledgement state, snapshot time, revocation; `iapEvents`; `iapNotifications` | yes | yes | | | |
| First valid binding wins; duplicate by same account idempotent; token never reassigned | yes | yes | | yes (Google echoes the binding) | |
| No overlap with an active Membership, both directions, at every entry point | yes | yes | | | interpretations I1 to I3 |
| A staff write never overwrites a live Google Play subscription | yes | yes | | | interpretation I2 |
| Account binding delivered to the client before purchase (`purchase-context`) | yes | yes | | yes | |
| Verify: ownership gate, provider fetch with timeout, entitlement only after verification, acknowledgement only after entitlement | yes | yes | | yes | |
| Provider failures are a closed set of codes; no provider text returned | yes | yes | | | |
| Kill switch, default off, explicit environment label; lifecycle ignores it | yes | yes | yes (flip it) | | production enablement |
| Notifications: message-id dedupe, bounded retry, wrong-package and unknown-token handling | yes | yes | yes (Pub/Sub) | yes | |
| Grace, hold, pause, ordinary cancellation to paid expiry, expiry, renewal | yes | yes | | yes (exact states) | |
| Refund and revocation by voided current order; stays void | yes | yes | | yes (payload and semantics) | owner decisions 5, 6 |
| Stale token, older snapshot, successor token | yes | yes | | | |
| Acknowledgement retry job; reconciliation job; paid-expiry cut-off without any notification | yes | yes | yes | yes (three-day window) | |
| Audit log holds no token, binding or provider text | yes | yes | | | |
| Backfill script (dry run first) and read-only report script | yes | yes | | | do not run on production without approval |
| Android purchase flow in the app (flow, token persistence, wording, UI card) | yes | yes | | yes (needs a device) | |
| Native billing library in the app | **no** | | | yes | library choice (decision 11) |
| Operations runbook | written | | yes (never run) | | |

## 4. Not done, and why

| Item | Reason |
|---|---|
| The native billing library, its config plugin and a development build | cannot be verified here, and a wrong plugin could break the production Android build |
| Any run against Google Play | not permitted by the safety boundaries, and no staging environment exists |
| iOS / Apple | out of scope by owner default D6. No Apple provider exists |
| Revenue reversal on refund; the revenue amount basis | open accounting decision (D8). Revenue is booked at the configured placeholder price |
| Account deletion with an active subscription | owner decision 6. Hard delete frees the token for another account |
| A Stripe or Revolut checkout completing after a Play purchase | now **refused and audited** by the cross-provider guard (tested). Still open: what happens for the member who paid at the refused provider (manual cancel and refund today), and a deliberate provider-transition API, which needs an owner decision |
| An admin view of the audit log | the log is written but no role can read it yet |
| Free-text console logging audit | not covered |

## 5. Open owner decisions

| # | Decision | Where it bites |
|---|---|---|
| 3, D8 | revenue basis and recognition | `revenueEvents` amounts for Play |
| 4 | merchant and account ownership | who owns the Play payments profile |
| 5 | refund and revocation responsibility, and whether access is cut immediately | the voided-purchase rule |
| 6 | account deletion with an active subscription | hard delete frees a token |
| 8 | is App Subscription permanently platform-global | `deliveryChannel: "app_only"` |
| 9 | may gym admins grant the platform tier manually | unchanged by this work, but now obeys the conflict rules |
| 11 | billing library | the mobile PR |
| 12 | staging environment | everything under "requires staging" |
| I1 to I7 | interpretations the defaults left open (`docs/iap-multitenant-implementation-plan-2026-10.md` section 2) | conflict rules, the 10-minute tolerance, a paused Membership counting as active |

## 6. Validation recorded

| Check | gym-app (this stack) | sc-coaching-mobile |
|---|---|---|
| `git diff --check` | pass | n/a |
| ESLint on changed files | pass | pass |
| `tsc --noEmit` | pass | pass |
| Full test suite | pass (see the PR body for the count) | 85 tests pass |
| Production build / bundle | `next build --webpack` passes (WASM SWC locally; CI is authoritative) | `expo export --platform android` passes |
| Migration verification | backfill dry run, apply, idempotency and no-secrets output tested on a temporary file | n/a |
| End-to-end | six journeys through real routes and a real temporary datastore with a fake provider | n/a |
| Against Google Play | **not run** | **not run** |

One local-only note: `__tests__/app/staff-reports-operations-gym-scope.test.ts` is a pre-existing timezone flake (its fixture
uses the UTC date and the app uses the local date), which fails between 00:00 and 01:00 local time in BST. CI runs in UTC.

## 7. Defect found by the end-to-end journeys

A manual write over an **ended** Google Play row used to inherit the old Play purchase token, billing option and paid
period. The inherited past period end made a freshly granted Membership read as lapsed, so the conflict rules treated it as
not active. Fixed in this PR for the staff tier grant, admin activation and the staff subscription override, with
regression tests (`__tests__/api/iap-leaving-play.test.ts`).
