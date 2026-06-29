# Surface architecture: real vs. prototype

This repo currently contains two disconnected systems. Read this before wiring
any of the prototype surfaces to real auth or data.

## Real (auth + database backed)

- `/login`, `/signup`, `/forgot-password`, `/reset-password` — `app/(auth)/`
- `/dashboard/*` — `app/(dashboard)/`

Backed by `lib/db.ts` (file-based store at `data/db.json`), `lib/session.ts`
(signed session cookies), and `lib/password.ts`. Gated by `proxy.ts`, whose
`matcher` only covers `/dashboard/:path*`, `/login`, `/signup`. Mutation
endpoints under `app/api/auth/*` and `app/api/{profile,programme}/update` have
test coverage in `__tests__/api/`.

## Prototype (mock data, unauthenticated)

- `/app` — `app/(member)/` — member-facing mobile UI (home, profile, coach,
  messages, resources, schedule, workouts)
- `/admin` — `app/(admin)/` — staff-facing desktop UI (analytics, inbox,
  members, reports, resources)
- `/admin-mobile` — `app/(admin-mobile)/` — staff-facing mobile UI (inbox,
  members, schedule)

All three are backed entirely by `lib/mock-data.ts` (hardcoded members,
workout sessions, classes, messages, resources, attendance, reports). None of
them read `lib/db.ts`, `lib/session.ts`, or check a session at all. `proxy.ts`
does not gate any of them — they are fully public routes today.

## Why the split exists, and what to do about each side

**`/app` is intended to become real.** `docs/onboarding-schema.md` — the
original planning doc for the auth/profile system — explicitly lists
`/(member)/app/page.tsx` and `/(member)/app/profile/page.tsx` under the same
"Route structure suggestion" as `/(auth)/login` and `/(auth)/signup`. The real
dashboard built in `app/(dashboard)/` only covers profile + programme; `/app`
already has the UI for the features the dashboard is missing (workouts,
schedule, messages, resources, coach). Treat the dashboard's auth/data layer
and `/app`'s UI as two halves of the same eventual product that haven't been
connected yet.

Before connecting any `/app` page to real data: design a real data model for
that one feature in `lib/db.ts` (mirroring how `ProgrammeRecord` was designed —
see `lib/db.ts` and `app/api/programme/update/route.ts`), the same deliberate
way, one feature at a time. Do not bulk-convert all seven pages at once, and do
not assume `lib/mock-data.ts`'s shapes are the right real schema — they were
designed for a static demo, not for write-flows or per-user ownership checks.

**`/admin` and `/admin-mobile` are undecided.** There is no planning-doc
evidence either way. They are staff-facing, and the real system has **no role
concept at all** — every signed-up user is identical (`UserRecord` has no role
field). Converting these requires deciding who can act as staff before any
implementation starts; this is the same open question already deferred for
programme assignment (see `app/api/programme/update/route.ts` — self-serve
only, by design, because no coach/admin role exists yet). Do not build
anything for these surfaces until that question has an answer.

## Guardrails

- Do not add `/app`, `/admin`, or `/admin-mobile` paths to `proxy.ts`'s
  `matcher` until that specific surface is actually being converted — adding
  them earlier would silently break the prototype (redirecting logged-out
  visitors to `/login`) without it actually being wired to real data yet.
- Do not import from `lib/mock-data.ts` into any file under `app/(auth)/`,
  `app/(dashboard)/`, or `lib/db.ts`. Do not import `lib/db.ts` or
  `lib/session.ts` into any file under `app/(member)/`, `app/(admin)/`, or
  `app/(admin-mobile)/` without first reading this doc and confirming the
  conversion is intentional, scoped, and approved.
