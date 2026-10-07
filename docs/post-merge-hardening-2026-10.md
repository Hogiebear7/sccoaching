# Post-merge hardening: findings and where each one is handled (2026-10)

After the multi-tenant and Google Play stack (`#60` to `#66`) was merged at `fa4bc02`, a final audit found no blockers but eight items. Each is
handled by its own focused PR (`#67` to `#70` were merged in that order on 2026-10-07, followed by this documentation PR). **This is not a production-readiness statement**, and Google Play IAP stays
off (`GOOGLE_PLAY_IAP_ENABLED` is unset by default).

| Finding | Severity | Handled in | Status |
| --- | --- | --- | --- |
| Runtime tenant helpers were not used by any production route | Medium | PR `#67`, `docs/runtime-tenant-context-adoption-2026-10.md` (added by that PR) | Incremental: 7 routes adopt the helpers. **Not** a full migration. Remaining routes are listed in that doc. |
| Hard deletion could orphan an active Play subscription | Medium | PR `#68`, `docs/member-deletion-protection-2026-10.md` (added by that PR) | Deletion refused (`active_subscription`) for active, past_due, paused and cancelled-but-paid Play entitlements; ended records anonymised, not deleted. |
| Stale-checkout cleanup could clear a parked Stripe checkout | Medium | PR `#69`, `docs/stale-checkout-recovery-2026-10.md` (added by that PR) | Checkouts are parked, never discarded; a late payment is reconciled through the provider guard or refused for manual recovery. |
| A doc claimed the new Play routes used the tenant helpers | Low | PR `#67` | Corrected in `docs/tenant-context-and-authorization-2026-10.md`. |
| Staff pause/resume unguarded on Play-billed rows | Low | PR `#70`, `docs/iap-low-severity-hardening-2026-10.md` (added by that PR) | Refused with `play_billing_active`. |
| Refused Revolut events could create duplicate audit rows | Low | PR `#70` | One audit row per distinct refused event (hash key). |
| No global network guard in tests | Low | PR `#70` | Registered as a vitest setup file; loopback open. |
| `iapEvents` has no reader and no retention limit | Low | PR `#70` (documented) | Follow-up, owner policy needed. Nothing is pruned. |
| Mobile shows `other_provider_active` as a generic error | Low | PR `#70` (documented) | Follow-up in `sc-coaching-mobile`, which was **not** modified. |
| Base branch is unprotected and pushes do not run CI | Process | `docs/repository-branch-protection-2026-10.md` (this PR) | Recommended settings only; **no repository setting was changed**. |

PR numbers `#67` to `#70` are as opened; re-check them if any PR is closed and recreated. The docs marked "added by that PR" are on the base
branch now that those PRs are merged.

## Rules that stay in force

- A row is billed through one provider at a time. A live entitlement (active, past_due, paused, or cancelled but paid through) is never
  overwritten, deleted or orphaned by another provider, a late checkout, a staff pause or a hard delete.
- Nothing cancels, refunds or transfers a member between providers automatically. Each refusal leaves an audit event (hashed references only)
  for staff to resolve.
- Historical purchase and audit records are preserved.

## Owner decisions still open

These are unchanged by this work and were not decided silently:

- Account deletion policy for ended or anonymised purchase records (erase them too, or keep them), and retention for `iapEvents`
  (decision 6 and the LOW 5 follow-up).
- What to do for a member who paid at a refused provider (refund or let it stand), and whether a deliberate provider-transition API is wanted.
- Revenue basis and recognition (D8, decision 3), merchant and account ownership (decision 4), refund and revocation responsibility (decision 5).
- Whether App Subscription is permanently platform-global (decision 8), gym-admin manual grants (decision 9), the billing library (decision 11).
- Mobile copy for `other_provider_active` (LOW 6).
- Which branch-protection settings to apply, and whether to move from merge commits to squash with linear history.

See `docs/iap-implementation-status-2026-10.md` section 5 for the full list.
