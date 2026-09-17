# White-label coaching platform — master plan

Durable product and architecture reference for turning S&C Performance
Coaching into a multi-tenant, branded gym/studio platform. Transcribed from
the source PDF (`white-label-platform-master-checklist.pdf`) provided
2026-09-17, kept practical and specific to this repository.

**This document defines direction and constraints. It is not approval to
implement any of it.** Every phase below requires its own explicit,
separately-approved slice. See `docs/tenant-boundary-audit-2026-09.md` for
the current-state audit this plan is evaluated against, and
`docs/tenant-scope-checklist.md` for the checklist any future tenant-adjacent
route must satisfy.

## Purpose

One shared multi-tenant coaching and gym-management platform. Each gym or
studio gets a branded tenant experience, tenant-specific classes and
memberships, scoped staff access, and tenant-owned member data — all on one
codebase, one controlled platform.

## Non-negotiable principle

**Tenant isolation is more important than branding.** Every tenant-owned
record, query, permission, message, metric, payment, and file must be scoped
to a tenant and tested against cross-tenant leakage.

## Decisions to lock first

- One shared application and one shared admin portal — not a separate
  codebase per gym.
- Runtime tenant branding first — not separate App Store/Play Store apps per
  tenant.
- Each tenant gets a private workspace inside the shared admin portal.
- S&C Performance Coaching is the reference tenant; prove workflows there
  first.
- Tenant billing and member billing stay two separate commercial flows.
- Tenant-owned payment accounts (likely Stripe Connect), not every gym's
  money routed through the platform's own account.
- Plan tenant architecture now; defer full white-label implementation until
  the current core product is stable.

## Product layers

| Layer | Owns / controls |
|---|---|
| Platform | Tenant creation, global settings, feature flags, platform billing, support, super-admin access, security and release management. |
| Tenant owner | Branding, memberships, prices, classes, staff, messages, tenant members, payment setup, operational settings. |
| Tenant admin | Delegated operational control within one tenant. |
| Coach | Only assigned or permitted member data, coaching messages, sessions and relevant metrics. |
| Member | Own data, own memberships, permitted classes, workouts, nutrition, recovery and tenant interactions. |

## Tenant architecture checklist

- Define the tenant entity and immutable tenant ID.
- Decide how a user is linked to one or more tenants.
- Define tenant membership status separately from global user account status.
- Add tenant ownership to every tenant-owned domain record.
- Create tenant-scoped repository/query helpers.
- Prevent queries without an explicit tenant scope, except for deliberate
  platform-admin operations.
- Add authorization checks at the API/service layer, not only in the UI.
- Define cross-tenant access rules explicitly; default to deny.
- Define whether a member can belong to multiple tenants, and what happens
  to their shared profile if so.
- Define tenant deletion, suspension, export, and data-retention behaviour.
- Write cross-tenant leakage tests for members, classes, messages, metrics,
  payments and files.

**Suggested core entities**: `Tenant`, `TenantBranding`, `User`,
`TenantMembership`, `TenantRole`, `StaffAssignment`, `GymLocation`, `Class`,
`ClassSchedule`, `MembershipPlan`, `Subscription`, `PaymentAccount`,
`PaymentEvent`, `CoachMessage`, `MetricRecord`, `Workout`, `NutritionRecord`,
`ReadinessRecord`, `FeatureEntitlement`, `AuditEvent`.

## Roles and permissions

- Define platform super-admin permissions separately from tenant-owner
  permissions.
- Define tenant owner, tenant admin, coach, staff, and member roles.
- Use tenant scope on every role assignment.
- Do not assume every coach can see every member's metrics.
- Define assigned-member access and exceptions for group coaches.
- Protect messages and health/training data by default.
- Log sensitive reads and administrative mutations.
- Add authorization tests for same-tenant allowed access and cross-tenant
  denied access.
- Define owner-transfer and staff-removal workflows.
- Define what happens when a staff member belongs to multiple tenants.

## Branding and tenant experience

- Define tenant display name, logo, splash logo, primary colour, accent
  colour.
- Define safe branding validation and fallback values.
- Decide whether logos are uploaded, stored, resized and served from a
  controlled asset system.
- Load tenant configuration after tenant resolution and before branded
  surfaces render.
- Branding must never override accessibility contrast or core navigation
  clarity.
- Keep the core product structure consistent across tenants.
- Allow tenant-specific timetable, classes, memberships and coach roster.
- Use feature flags rather than code forks for tenant differences.
- Decide whether custom domains and separate app-store listings are
  explicitly deferred.

## Admin portal

- One shared tenant-aware admin application.
- Route each owner to their tenant workspace after login.
- A tenant switcher only for users explicitly allowed to manage multiple
  tenants.
- Tenant dashboard, members, classes, timetable, memberships, payments,
  staff, messages, branding and settings.
- Keep platform super-admin tooling separate from tenant admin tooling.
- Clear tenant context on every admin page.
- Never let an admin request rely on a client-supplied tenant ID without
  server authorization.
- Audit history for membership, payment, role, visibility and data-access
  changes.
- Export and support workflows before onboarding external tenants.

## Payments and memberships

**Two flows stay separate:**
- Platform owner pays S&C for use of the SaaS platform.
- Gym members pay their gym or studio for memberships, classes, passes or
  services.

- Choose the payment platform and confirm country, currency, tax and legal
  requirements before implementation.
- Create connected payment accounts for tenant businesses where appropriate.
- Complete tenant business verification and onboarding.
- Define who is merchant of record for tenant memberships.
- Create tenant-owned products and prices.
- Handle subscriptions, one-off purchases, refunds, failed payments,
  disputes, cancellations and prorations.
- Process payment webhooks idempotently and scope every event to the correct
  tenant.
- Keep platform fees and tenant revenue distinct in reporting.
- Add reconciliation and audit records.
- Build tenant admin controls for plans and memberships only after payment
  ownership and permissions are secure.
- Define what happens when a tenant disconnects its payment account.

## Privacy, messages and metrics

- Define whether tenant owners can see all tenant member metrics.
- Define whether coaches can see only assigned members.
- Define which messages are visible to owners, admins, coaches and members.
- Prevent a coach in Tenant A from reading Tenant B data.
- Apply tenant scope to analytics and exports.
- Define retention, deletion, correction and export processes.
- Document sensitive-data handling and access logging.
- Define member consent and notification expectations before onboarding
  external tenants.
- Do not expose hidden provider status or private business reasons to
  directory users.

## Operational readiness

- Tenant onboarding checklist.
- Owner identity and business verification checklist.
- Branding approval checklist.
- Data import and migration plan.
- Billing setup and payout verification.
- Staff invitation and role assignment.
- Class and timetable setup.
- Member import and duplicate handling.
- Support and incident process.
- Tenant suspension and offboarding process.
- Backup, restore and audit process.
- Per-tenant monitoring and error tracing.

## Recommended phased roadmap

**Phase 0 — Document and protect the direction.** Define tenant boundaries,
roles, billing ownership, branding model, data-scope rules and non-goals. Do
not build the white-label layer.

**Phase 1 — Harden S&C as the reference tenant.** Finish core workouts,
nutrition, readiness, schedule, memberships, messages, metrics, payments and
admin workflows for S&C.

**Phase 2 — Introduce explicit tenant abstraction.** Add tenant identity,
tenant-scoped queries, tenant-aware permissions and cross-tenant tests.

**Phase 3 — Convert admin into a tenant workspace.** One shared admin portal
with tenant context, owner/admin/coach roles and tenant configuration.

**Phase 4 — Add branded runtime experience.** Load tenant branding, classes,
memberships and feature flags in the shared app.

**Phase 5 — Add tenant-owned billing.** Connected accounts, member
subscriptions, webhooks, refunds, reconciliation and platform fees.

**Phase 6 — Pilot with one external gym.** Onboard one carefully selected
tenant, observe support and data boundaries, then revise before scaling.

**Phase 7 — Productize onboarding.** Repeatable tenant onboarding,
documentation, pricing, support and commercial controls.

## What Claude (or any future session) should and should not do

Read this document before any work related to tenant architecture, branding,
gym/provider onboarding, staff permissions, memberships, payments,
messaging, metrics, or branded app behaviour. It is the durable product and
architecture reference — **not permission to implement the whole platform.**
Work only on the specific slice requested in the current prompt. Do not infer
approval for adjacent features.

**Non-negotiable principles**: tenant isolation before branding polish;
server-side authorization before UI hiding; one shared application and
shared tenant-aware admin portal; runtime branding before separate app-store
apps; tenant-owned data and payment boundaries must be explicit; platform
billing and member billing are separate flows; default cross-tenant access
is deny; preserve the working S&C reference tenant while introducing
abstractions; avoid code forks and feature pile.

**Before editing:**
1. Read the relevant sections of this document.
2. Inspect the current repository and identify what already exists.
3. State the current data flow and authorization flow.
4. Identify exact files and any schema, migration, payment, privacy or
   security implications.
5. Propose the smallest safe implementation slice.
6. State what must remain deferred.
7. Stop for approval if the change affects tenant boundaries, payments,
   sensitive data, or permissions beyond the approved scope.

**During implementation:** keep changes focused; reuse established project
conventions; do not create duplicate concepts when an existing one is safe
and semantically correct; do not weaken authorization to make a UI flow
work; do not use client-supplied tenant IDs without server-side scope
validation; add or update directly related tests when the contract changes;
report any scope deviation before committing.

**After implementation:** summarize exact files changed; list tests and
validation performed; report any pre-existing failures separately; confirm
tenant isolation and authorization checks; confirm no unrelated files were
changed; identify the next smallest safe slice and deferred work.

## Explicit non-goals for now

- Separate App Store or Google Play apps for every gym.
- Custom codebase forks per tenant.
- Full marketplace discovery with reviews, ratings and messaging.
- Advanced multi-location franchise reporting.
- Automatic booking-based capacity inference.
- Custom domains for every tenant.
- Complex cross-tenant analytics.
- Full accounting system.
- Building payment flows before ownership, tax and compliance decisions are
  documented.
- Building branding before tenant isolation and authorization are secure.

## Final go/no-go gates

- No external tenant pilot until tenant-scoped authorization is tested.
- No member billing until payment ownership and webhook handling are
  documented.
- No sensitive metrics rollout until staff/member visibility rules are
  explicit.
- No runtime branding rollout until fallback and accessibility rules exist.
- No scale-up beyond the first pilot until support, offboarding and audit
  processes work.
- No separate app-store apps unless a paying tenant proves the commercial
  need.

## Bottom line

Maintain this document as a source of truth and guardrail — not as a request
to build everything at once. The pattern: master plan → repository
inspection → small approved slice → validation → update the plan → next
slice.
