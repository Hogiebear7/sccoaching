# Tenant onboarding, branding and the gym guide (2026-11-25)

Completes the tenant experience alongside the platform billing and lockout system (`docs/tenant-lockout-2026-11.md`).

## What a new gym gets

1. **Sign-up page** `/gym-signup` (public, uses the existing `POST /api/gyms/signup`, rate limited to 3 per client per hour). It creates the gym as `pending` and the owner as an `admin_manager` of that gym, signs them in and sends them to the setup checklist. The gym is not listed in the member directory until a platform operator approves it (`/api/staff/gyms/[gymId]/status`).
2. **Setup checklist** `/staff/gym-setup` (admin and above). Every tick is computed from real data (branding set, tagline and description, address located, approved, first class, a second staff account, first member, platform subscription paid), so it cannot drift.
3. **Logo and accent colour** on the same page, saved through `PUT /api/staff/gym/branding` (capability `gym.manageBranding`, admin tier).
4. **Gym guide** `/staff/gym-guide` (any staff): the instruction manual, in the order a new owner needs it.

## Branding rules

- One accent colour (`#RRGGBB`) and one logo (https link to png, jpg, webp or svg, at most 500 characters, no credentials in the link).
- The accent must have at least 4.5:1 contrast against the app's dark background (`#0A1526`); darker colours are refused with a message. The S&C gold is the fallback and passes the same check. Text on top of the accent is chosen automatically (black or white, whichever reads better).
- A gym always edits **its own** branding: the route takes no gym id. S&C's own brand (the primary gym) is fixed and refused here.
- Nothing about the product's structure or navigation changes per gym.

## Where it shows

- **Member web area** (`/dashboard`): the gym's logo (or its name when it has no logo) in the sidebar and top bar, and the accent on buttons, links and badges. The S&C gym and any gym with nothing set keep the S&C look.
- **Mobile app**: `GET /api/mobile/auth/me` returns `branding { name, accentColor, onAccent, logoUrl, custom }` (the S&C defaults when nothing is set). The app reads it at sign-in and on launch.

## Proof

`__tests__/api/gym-branding.test.ts`: the colour and logo rules (including unsafe links), keep-what-is-not-sent and clear-with-null, the route for a gym's own admin, refusals for a member and for S&C's own staff, no way to name another gym, and what the session check reports.
The route is in the route manifest (own-tenant, lockout enforced) and in the runtime-context adoption table, both checked against the source by tests.

## Still the owner's, by design

- Logo upload: today a gym supplies a link to a logo it hosts. A hosted upload would need a controlled asset store and resizing; deferred (see the master plan).
- Approval of a new gym stays a platform-operator decision.
- Custom domains and separate store apps per gym are explicit non-goals (master plan).
