# Merchant-of-record decision — phased model (2026-09)

Records an owner decision made 2026-09-30, against base SHA `5bf0b9921b2033cc4659a093ebf3c1d8a1a2ee77`
(all PRs #50–#56 merged; every second-gym **code** blocker closed — see
`docs/tenant-boundary-audit-2026-09.md` and the companion
[Second-Gym Readiness Audit](https://claude.ai/artifact/7j5zHf4Ke4AjGGiaAHadCp) and
[Merchant-of-Record Decision Memo](https://claude.ai/artifact/QaDbfU25yYhNQT2gnv1uSw)
artifacts this decision follows from.

**This document records a decision. It is not, and does not claim to be, legal
approval, accounting sign-off, or provider confirmation.** Those are separate,
still-outstanding gates listed in full below. Do not treat this document as
clearance to onboard Gym B — see "Launch gate" for what still has to happen
first.

## Decision

**Option C — phased payment model** is selected for the initial Gym B launch.

| # | Element | Status |
|---|---|---|
| 1 | S&C remains merchant of record for the initial phase | **Owner-approved decision** |
| 2 | Stripe, Revolut, and Google Play remain platform-level accounts (unchanged, single secret/account each) | **Owner-approved decision** |
| 3 | Gym B settlement is a separate, documented manual/scripted process — not a provider-level payout | **Owner-approved decision**; settlement mechanics themselves are an **engineering follow-up** |
| 4 | Finance access remains exact-role `platform_operator` only, unless separately changed | **Owner-approved decision** (no change from current code) |
| 5 | Stripe Connect is **deferred, not rejected** — a future transition to tenant-owned payment accounts remains possible | **Owner-approved decision** |
| 6 | A future Connect migration must preserve historical `ownerGym` provenance already written by PRs #49/#51/#55 | **Owner-approved decision**; the schema already satisfies this today (see "Why this is safe to defer," below) |
| 7 | The Gym B agreement must explicitly anticipate a future payment-account migration | **Legal/accounting approval required** — drafting and execution are not done by this document |
| 8 | App Subscription remains platform-global and mobile/IAP-dependent (unaffected by this decision either way) | **Owner-approved decision** (already enforced in code by PRs #52/#53/#56) |
| 9 | Multi-gym-per-user remains out of scope unless separately approved | **Owner-approved decision** (unaffected by this decision) |

### Why this is safe to defer (repository evidence, not a legal opinion)

`SubscriptionRecord.ownerGym`, `PurchaseRecord.ownerGym`, `PaymentEventRecord.ownerGym`,
`PassLedgerEntryRecord.ownerGym`, and `RevenueEventRecord.ownerGym` (PRs #49, #51, #55)
are already immutable, explicit, per-record provenance, stamped at write time and
never recomputed. A future migration to Stripe Connect would need exactly this kind
of historical attribution to correctly assign past revenue to the right gym — it
already exists. Deferring Connect today costs nothing technically and loses no
information for later; the only real cost of deferral is legal (item 7 above), not
engineering.

## Legal/accounting prerequisites (not obtained by this document)

- [ ] Confirm S&C may lawfully act as merchant of record for a second,
      independently-operated gym's memberships in the relevant jurisdiction(s).
- [ ] Confirm S&C's tax registration/remittance obligations, and whether they
      change if Gym B operates in a different jurisdiction than S&C's own.
- [ ] Confirm and document who bears refund, chargeback, and dispute
      responsibility under this model (S&C, per the merchant-of-record role).
- [ ] Confirm the payout/settlement responsibility split between S&C and Gym B.
- [ ] Execute a Gym B revenue-share/agency agreement.
- [ ] Confirm that agreement explicitly anticipates a future transition to a
      tenant-owned (Connect-style) payment model, so migrating later isn't a
      renegotiation from scratch.

## Provider prerequisites (not obtained by this document — no provider was contacted)

- [ ] Confirm Stripe's current account terms permit processing payments on
      behalf of a separate business (Option A/C's model) without requiring a
      business-model disclosure or separate approval from Stripe.
- [ ] Confirm the same for Revolut.
- [ ] Document whichever account terms or required disclosures either
      provider's confirmation surfaces.

## Finance / settlement requirements (operational design, not yet built)

- [ ] Define the settlement calculation (how Gym B's share of revenue
      collected under its `ownerGym`-tagged records is computed).
- [ ] Define the settlement cadence (e.g. monthly).
- [ ] Define who owns reconciliation (compares settled amounts against the
      `ownerGym`-filtered Finance ledger).
- [ ] Define refund/chargeback handling in the settlement calculation (does a
      later refund claw back from a already-settled amount, or net against
      the next cycle?).
- [ ] Define audit retention for settlement records, consistent with whatever
      financial-record retention policy already applies to S&C's own books.
- [ ] Finance access stays `platform_operator`-only for this initial phase —
      no code change required; re-confirm this is still the intended access
      model once settlement tooling exists, since building settlement
      reports might create pressure to give Gym B some visibility into its
      own numbers.

## Infrastructure gates (unrelated to payments, but bundled into "ready for Gym B")

Re-stated from the Second-Gym Readiness Audit — unaffected by this decision,
still outstanding, still requiring owner/Hostinger access this engagement
does not have:

- [ ] Confirm the Hostinger runtime meets the app's Node version requirement.
- [ ] Confirm `npm ci` succeeds on the deployment host.
- [ ] Confirm `next build --webpack` succeeds on the deployment host (the
      `--webpack` flag is load-bearing there — see `docs/deployment-operations.md` §1).
- [ ] Confirm `next start` runs correctly as the one long-lived process the
      app's single-process/unlocked-JSON-file model requires (`docs/deployment-operations.md` §3).
- [ ] Confirm `DATA_DIR` points at genuinely persistent storage that survives
      redeploys.
- [ ] Confirm an actual backup process exists (none was designed by this
      engagement — `docs/deployment-operations.md` §5 flags this as a gap).
- [ ] Confirm a rollback procedure has been exercised at least once, not just
      documented (`docs/deployment-operations.md` §9).
- [ ] Confirm `TRUSTED_PROXY_HOPS` against Hostinger's actual network
      topology if public-facing rate limiting is to be trusted at two-tenant
      scale (`docs/deployment-operations.md` §2).
- [ ] Run the two-tenant smoke test from `docs/deployment-operations.md` §8
      against real Hostinger staging (or the approved equivalent) — not yet
      run, requires an environment this engagement doesn't have access to.

## Application gates (code-level — verified in this pass)

- [x] PRs #50–#56 confirmed present on `redesign/index-html-blueprint` at
      HEAD `5bf0b99`.
- [x] `npm audit --omit=dev` — 0 vulnerabilities.
- [x] Invite-bound gym assignment fails closed on an invalid invite (PR #50).
- [x] `SubscriptionRecord.ownerGym` is immutable once stamped (PR #51),
      preserved through cross-scope switch attempts, which are themselves
      blocked (PR #53).
- [x] Google Play server-side account binding is enforced (PR #52).
- [x] Class categories, classes/series, bookings, and booking cancellation
      are gym-scoped (PR #54).
- [x] `RevenueEventRecord.ownerGym` is stamped at all 4 write sites (PR #55).
- [x] A new `app_only` package cannot be created by gym-level staff — only
      `platform_operator` (PR #56).
- [ ] No production-data migration has been run, or is authorized by this
      document. Every backfill script shipped alongside PRs #49, #51, #54,
      and #55 remains report-only in production; running any of them with
      `--confirm` against real data requires a separate, explicit approval.

## Deferred project — Stripe Connect (not started, not scoped in detail here)

Recorded so the eventual migration has a starting checklist, not a design.
None of the following is implemented by this document or this task:

- A `GymRecord` field (or equivalent) to hold each gym's connected-account id.
- The Stripe Connect account-type decision (Standard / Express / Custom) —
  each has different KYC, UI, and liability implications; not decided here.
- A real gym onboarding/KYC flow — `app/api/gyms/signup` today only creates a
  pending `GymRecord`, with no provider-side step at all.
- Per-gym checkout account resolution — `lib/providers/stripe.ts`'s
  `getSecretKey()` is a single global lookup today; would need to resolve a
  connected account per checkout call.
- Application-fee and transfer handling, if S&C takes a platform cut once
  Connect is live — no code for this exists today.
- Webhook `event.account` routing — every Stripe/Revolut webhook handler
  today resolves purely by provider-object id; under Connect, every handler
  would need to resolve the event's account into a tenant *before* any
  record lookup.
- Re-verification of idempotency/dedupe assumptions once provider ids are no
  longer guaranteed globally unique across a single account.
- Refund/dispute routing to each gym's own connected account.
- A live-subscription migration plan for S&C's own existing Stripe activity
  (does it become "Gym A's" connected account, or stay the platform account
  with Gym A as a conceptual tenant of it — not decided here).
- Revolut multi-merchant/marketplace feasibility — not established anywhere
  in this codebase; needs a direct provider confirmation before Connect-style
  work is scoped for the Revolut side specifically.
- Google Play has no per-gym account concept at all and is unaffected by any
  of the above — the single platform-wide App Subscription product stays
  platform-global regardless of what happens to Stripe/Revolut.
- A rollback plan for the Connect migration itself, given real customers and
  real money would be involved by the time it's built.

## Second-gym gate impact of this decision

- Stripe Connect is **not** a code blocker for Gym B under this decision.
- Per-gym Finance reporting is **not** required for Gym B under this
  decision — internal `ownerGym`-filtered reporting is optional groundwork,
  not a gate.
- The current Hostinger smoke-test plan (`docs/deployment-operations.md` §8)
  does **not** need Connect-specific scenarios added under this decision.
- What **is** required before Gym B, specific to this decision: the legal
  and provider prerequisites above, and a working settlement process (even a
  manual one) before the first real Gym B transaction is processed.

## Readiness rating — unchanged by this document

**B — single-gym beta / owner testing only.** This document resolves the
*policy* question this rating's blocker list carried since the original
Second-Gym Readiness Audit, but resolving a policy question is not the same
as clearing its gate. The rating does not move until: the legal/accounting
prerequisites above are actually satisfied (not just documented as
required), the provider prerequisites are actually confirmed, a real
settlement process exists, and the infrastructure/evidence gates (backup,
rollback, Hostinger runtime, two-tenant smoke test) are separately verified
against the real deployment target. None of those steps were performed by
this task, and this document does not claim otherwise.
