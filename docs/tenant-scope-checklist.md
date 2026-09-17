# Tenant-scope checklist

Run through this checklist for **any** future route, page, or background job
that touches gym-, tenant-, member-, staff-, class-, message-, metric-,
payment-, or provider-owned data — before writing the implementation, not
after. See `docs/white-label-platform-master-plan.md` for the direction this
protects, and `docs/tenant-boundary-audit-2026-09.md` for the current-state
gaps this checklist exists to stop from growing.

This repo is single-tenant in production today, so none of these checks are
a hard requirement of the current system working correctly. They exist so
that new surfaces don't add to the backlog of gym-adjacent code with no
tenant scoping — see the audit's §3 and §6 for exactly what's already
missing it.

## Client-supplied IDs

- [ ] Does this route accept an id from the client (URL param, body field,
      query string) that identifies a gym-owned, member-owned, or
      staff-owned resource?
- [ ] If yes: is that id used to look up a record, then compared against the
      caller's own scope (`sameGym`/`sameGymAsStaff`, or the resource's own
      `userId` for a self-owned record) **before** any read or mutation?
- [ ] Never trust a client-supplied `gymId` directly — resolve "which gym"
      from the caller's own session/account, the same way
      `app/api/mobile/gyms/my-gym/visibility/route.ts` does.

## Explicit ownership / scope validation

- [ ] Does the record type involved already have a `gymId` (or equivalent
      tenant key)? If not, is ownership derived transitively through a
      `userId` join, and is that join actually performed before use — not
      assumed?
- [ ] Is the null/fallback-gym convention (`gymId == null` → primary gym)
      involved anywhere in this route? If so, add an explicit secondary
      check narrowing the fallback to the one named primary slug — don't
      rely on the fallback alone (see `app/api/mobile/gyms/my-gym/
      visibility/route.ts` for the precedent).

## Capability checks

- [ ] Is there a `can(role, capability)` check for every mutation and every
      read of non-public data?
- [ ] Is the capability check the *right* one — reused from
      `lib/permissions.ts`'s existing table, not a new ad hoc role string?
- [ ] Does the capability check alone actually answer "is this in scope,"
      or does it only answer "is this role senior enough" while leaving the
      gym/tenant boundary unchecked? (These are two separate questions —
      see `docs/tenant-boundary-audit-2026-09.md` §2 on why they're kept
      orthogonal in this codebase.)

## Cross-tenant denial tests

- [ ] Is there a test that asserts a staff user from a **different** gym is
      denied access to this route/resource — not just a test that the
      capability check exists?
- [ ] Is there a test for the self-owned case too, where relevant (a member
      cannot act on another member's resource by supplying their id)?

## Webhook / payment tenant resolution

- [ ] If this touches a payment webhook: is the event's provider-side
      account/tenant identity resolved and checked **before** any record
      lookup, not assumed from the payload's other fields?
- [ ] Is idempotency (event-id dedupe) still correct if two different
      tenants could plausibly produce colliding provider ids? (Today, ids
      are assumed globally unique because there is one Stripe account — see
      audit §4. Don't add new payment code that quietly depends on that
      assumption without noting it.)

## File / media ownership

- [ ] If this introduces uploaded or generated files (logos, exports,
      attachments): is there an owning gym/tenant/user recorded alongside
      the file, not just implied by which route uploaded it?

## Audit logging

- [ ] Does this route perform a sensitive read (health/training data,
      messages, financial figures) or an administrative mutation (role
      change, tier grant, account archive)? If so, is it worth a log entry
      recording who did it and to whose data — even a minimal one — rather
      than nothing?

## When in doubt

If a change genuinely can't satisfy one of these and you're not sure it
matters yet, say so explicitly in the PR/commit description rather than
silently skipping it. This checklist is a guardrail for a system that is
still single-tenant, not a blocker on every unrelated change.
