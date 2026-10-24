# Member area overhaul (October 2026)

Running change log for the logged-in member app (`/dashboard/*`) redesign on
the local branch `redesign/member-area` (cut from
`redesign/index-html-blueprint` at `7755665`). Not pushed. Each slice is a
separate local commit so any part can be reviewed or reverted on its own.

Scope: member screens only. Staff/admin surfaces, the public website and all
business logic, data, routes and permissions are unchanged.

## Slice 1 — App shell, shared recipes, screen identity

What changed
- **Scoped recipe overrides** (`app/globals.css`, bottom section): inside the
  member shell (`data-member-app`), the shared `.panel`/`.panel-raised` (frosted
  glass), `.btn-primary` (gradient capsule with glow), `.input-field` (blue focus),
  `.chip`, `.well`, `.empty-state`, `.chart-glow`, `.label-caps`,
  `.text-display`/`.title-athletic` are re-pointed at the navy/gold language:
  solid tonal surfaces, hairline borders, 3–6px geometry, flat gold actions,
  gold focus, no glows. Radius variables (`--radius-lg` etc.) are scoped too, so
  the 160+ `rounded-lg` usages become 4px without touching each file. Staff and
  admin keep the old recipes (they don't carry the attribute).
- **App bar** (`layout.tsx`): opaque navy, 56px. Phones: logo, Messages,
  Notifications (unread badge), avatar. The old Settings icon and "Log out"
  button left the phone bar (they now live behind the avatar, see Profile).
  Desktop: greeting, the same two inboxes, Staff area for staff.
- **Sidebar** (desktop): solid `--sidebar` navy instead of blurred glass; links
  get a gold left rule when current (`NavLink variant="member"`; staff keep the
  default variant); Notifications added under Account; member card + Log out at
  the foot.
- **Bottom tab bar** (`bottom-nav.tsx`): full-width opaque bar with a hairline
  instead of the floating glass capsule with a glowing pill; current tab is
  gold (icon, label, 2px top bar); 64px targets; `aria-current`.
- **Screen headers**: every member screen's slogan title ("Claim your spot, then
  show up.") replaced by the screen's name via `components/member/ScreenHeader`
  (gold section label + Teko title + one line).
- **SegmentedControl** (`components/member/SegmentedControl.tsx`): replaces the
  glossy pill tab switches on Schedule and Workouts; full width on phones, 44px,
  tablist semantics with arrow-key support.
- **Profile as the phone account hub**: `components/member/AccountMenu.tsx`
  (Membership, Bookings, Exercise library, Settings, Log out) under the Profile
  header on phones; header now shows the member's name.
- New primitives: `ListGroup` / `ListRow` / `StatusBadge`
  (`components/member/ListGroup.tsx`).

## Slice 2 — Home (dashboard)

- One question first: **"What should I do today?"** The header's supporting
  line states today's readiness (or asks for the check-in), and the signature
  "Today" card (gold top line) holds the readiness ring, its meaning, and one
  gold action: *Log today's check-in* (no check-in) or *Plan today's session*.
- Three KPIs with context sit in the same card (7-day load + band/week change,
  sleep + quality, sessions in 7 days); Teko figures, units in Inter.
- Readiness sparkline moved to a quiet footer row ("Readiness, last 14 days").
- Next session: typographic day/time block instead of an image rail; one
  "View schedule" row; empty state with an outline "Book a session" (gold is
  reserved for the day's main action).
- Nutrition, Membership/Coach and Shortcuts are settings-style list rows
  (`ListGroup`), not equal-weight tiles. Membership status is a semantic badge.
- Removed: decorative banner image and scrims, count-up number animation
  (frequent screen: no motion), glowing ring/sparkline.
- **Bug fixed:** sleep quality showed "/5" but is logged 1–10; now "/10".
- First-login tour (`lib/dashboard-tour.ts`) reordered to match: Today, then
  Next session. All `data-tour` targets kept.
- `ReadinessRing` gained a `quiet` variant (no glow, Teko score) for the app;
  the website preview keeps the original.
