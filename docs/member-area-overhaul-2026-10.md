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

## Slice 3 — Workouts, Recovery, Schedule, Bookings (+ type/shape pass)

- **Legibility pass (codemod, member files only):** every `text-[8–10.5px]`
  became `text-[11px]` (≈100 places; DESIGN.md forbids text under 12px, 11px
  is the floor for caps labels), and text chips/buttons using `rounded-full`
  became `rounded-[3px]` (≈60 places). Avatars, dots and the unread count stay
  round. Staff-only `DietaryRequirementsSummary` was left untouched; the
  shared `DietaryRequirementsFields` (member profile + signup) got 3px chips.
- Glassy `shadow-[inset_0_1px_…]` highlights removed from member files.
- Member form controls: 44px minimum height, 16px text on phones (no iOS
  zoom on focus) — scoped CSS, so the long workout/recovery forms gain it
  without per-field edits.
- Empty states: solid tile, 15px title, 14px body (scoped CSS); Bookings'
  empty state gets a "Browse the schedule" button; clearer Schedule copy.
- **Workouts:** Workout Helper loses its gradient wash; stats in Teko on a
  carved strip, context lines wrap instead of truncating ("Not logged tod…");
  time/equipment/focus controls are 40–44px with a raised selected tile.
  Streak/records figures in Teko, `kg` kept lowercase; history shows
  "Monday 21 September" instead of ISO dates; duration chip no longer
  stretches full width on phones.
- **Recovery:** hero uses the quiet ring + Teko status. **Honesty fix:** it
  said "Today's readiness" for the latest check-in even when that was weeks
  old; it now says "Last check-in · Sun 20 Sep" and prompts for today's.
  Recent days show friendly dates; Save is full width on phones.
  `readinessStatus` moved to `lib/recovery.ts` (client-safe) and re-exported
  from `lib/dashboard-data.ts`.
- **Bookings:** `BookingCard` uses a typographic time rail (Teko time,
  duration) like Home; semantic status badges; "Cancel booking" is a 40px
  outline button; inline alert styling for errors.
- **Schedule:** class covers kept (staff upload them for members), with a
  scrim instead of a text shadow; 40px secondary buttons; alert styling.

## Slice 4 — Messages, Settings, Nutrition, Library, colour clean-up

- **Messages:** "Your coach" is now the first and default tab (AI coach
  second). A deep link with an AI prompt (`?prompt=`) still opens the AI tab.
  `SegmentedControl` replaces the old pill toggle. The coach thread
  (`components/messages/MessagesThread.tsx`, shared with staff) gained an
  opt-in `variant="member"`: navy bubbles instead of teal, a gold "Coach"
  label, "18 Sept, 09:14" timestamps, gold-focus composer, friendlier empty
  copy. Staff keep the default variant.
- **Settings:** Log out added to Account details (Settings is where people
  look for it; phones also have it on Profile).
- **Nutrition:** emoji removed from the food-idea chips (text-only chips, per
  UI UX Pro Max "no emoji as icons"); the emoji map stays in
  `lib/nutrition-recommendations.ts`, unused by this screen.
- **Exercise library:** pre-existing problem — it rendered every exercise
  at once (≈141,000px tall on a phone). Now 24 at a time with
  "Show more (N left)", a live count, reset on search/filter changes; 44px
  search, favourites and filter controls.
- **Retired colours:** hard-coded teal/amber/emerald in the AI coach, Cycle
  and Programme screens mapped to semantic tokens (success, warning, gold
  accent, navy bubbles, gold focus). The legacy `components/member/*` files
  that only serve the blocked `/app` prototype were left alone.
- Error text (`.text-destructive`) uses a lighter tint of the danger red in
  the member app so it is readable on navy.

## Slice 5 — States and documentation

- `app/(dashboard)/dashboard/loading.tsx`: skeleton in the screen rhythm for
  route transitions (none existed; navigation showed nothing).
- `app/(dashboard)/dashboard/error.tsx`: in-app error with "Try again"
  (Next 16 `retry()`) and "Go to Home", keeping the app bar and tabs,
  instead of the full-page global error.
- `DESIGN.md`: new **Member app** section (principles, shell, components,
  scoped rules); app button and page-title entries updated; the "app buttons
  are pills" known gap closed.

## Slice 6 — Touch targets, visual baselines

- Toggle chips (`aria-pressed`, `role="radio"`, `role="tab"` buttons) get a
  40px minimum height in the member app (scoped CSS).
- Home: the 14-day sparkline needs at least two points; the header line reads
  "Readiness 71 today: ready to train as planned."
- Visual suite: `e2e/visual.spec.ts` messages check now waits for the coach
  composer (the screen opens on the coach thread); **win32** baselines
  regenerated locally for all six screens and re-run clean. **Linux
  baselines are now stale** and must be regenerated by the `visual-suite`
  workflow (`update_snapshots`) once this branch is pushed.

## Checks run (final)

- `npx tsc --noEmit`: clean.
- ESLint on every file changed on this branch: clean except two pre-existing
  problems, identical at the base commit (`NutritionAiCoach.tsx`
  set-state-in-effect; `components/member/WorkoutLogger.tsx` unused vars).
- `npx vitest run`: 219 files, 2,905 passed, 1 skipped.
- `npm run build`: compiles.
- Playwright visual suite: 6/6 pass against the new win32 baselines.
- Browser sweep of 12 member routes at 390px and 1440px: all 200, one `h1`
  each, no horizontal overflow, no console errors; tab bar keyboard focus
  visible; `aria-current` on the active tab.
- Checked-in state verified by logging a real check-in on the local dev
  datastore, then restoring `data/db.json` from a backup (checksum matched).

## Decisions made autonomously (review/revert individually)

1. Member recipes overridden by scoped CSS (`data-member-app`) rather than
   changing the shared utilities — staff/admin keep the old look for now.
2. Screen titles are plain names ("Recovery"); the slogans were removed.
3. Log out and Settings left the phone app bar; they live behind the avatar
   (Profile account hub), in Settings, and in the desktop sidebar.
4. Messages and Notifications icons added to the app bar.
5. Home order: Today (readiness + action) before Next session; tour order
   follows.
6. One gold action per section; "Book a session" on Home's empty state is an
   outline button.
7. Bookings and Home use a typographic time rail instead of class images;
   Schedule browse keeps covers (with a scrim).
8. Messages opens on the coach thread; AI coach is the second tab.
9. 11px floor for all text in member files (codemod); text chips square to
   3px; Space Grotesk replaced by Inter in the app.
10. Food-idea emoji removed from Nutrition.
11. Exercise library pages at 24 items.
12. No count-up number animation on Home.
