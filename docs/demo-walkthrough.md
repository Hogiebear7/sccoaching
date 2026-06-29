# Demo walkthrough

Run `npm run seed` to reset `data/db.json` to a clean demo state, then
`npm run dev`. All seeded accounts use the password `Demo1234!`.

**Re-run `npm run seed` right before any demo session**, not just once when
the project was set up. `data/db.json` is local, gitignored, throwaway state
— it does not persist or sync anywhere, and any account created ad hoc
(e.g. via the signup form while testing something) is wiped the next time
someone reseeds. Only the seven accounts below are guaranteed to exist after
a reseed. Seeding also stamps a few timestamps relative to "now" — notably
Jordan's pending checkout (see below), which is only meant to look "a few
minutes old"; if it sits for 30+ minutes before the demo, the app correctly
treats it as abandoned ("Checkout expired" in the UI, or actually expired to
`inactive` once the scheduler runs — see Step 5). Reseed immediately
beforehand to avoid that.

## Accounts

| Email | Role | What it demonstrates |
|---|---|---|
| `coach@demo.local` | Staff | Full staff toolkit: Operations overview, classes (categories + waitlists), plans (EUR pricing, session allowances, category eligibility), member detail (coach summary, membership override, recovery, messages) |
| `alex@demo.local` | Member | The "everything working" member: active Premium membership (unlimited sessions, all general categories), 5 days of recovery logs, upcoming + past bookings, a message thread with the coach |
| `jordan@demo.local` | Member | Membership stuck `pending` — mid-checkout, awaiting payment confirmation; also on the waitlist for the (full) Evening Conditioning class |
| `sam@demo.local` | Member | No plan selected yet — triggers the booking-gate banner on the Schedule page |
| `taylor@demo.local` | Member | Membership `past_due` — shows the red status badge on both member and staff views |
| `morgan@demo.local` | Member | Active **Mother & Baby** plan — can only book the Mum & Baby class; cycle tracking enabled with phase shared with coach |
| `riley@demo.local` | Member | Active Premium whose billing period already lapsed, **not yet** flagged by housekeeping — sign in as `coach@demo.local` and run housekeeping (Step 5) to watch it get caught |

## Suggested walkthrough

1. **Sign in as `alex@demo.local`.** Dashboard overview shows a real
   readiness score, an active Premium membership badge, and "Unlimited
   sessions this billing period." Visit Schedule — classes show their
   category (Strength/Cardio/Mother & Baby) and a live "X of Y booked"
   count. Visit Bookings — each upcoming booking shows whether cancelling
   right now would restore the session credit (12h cutoff by default).
   Visit Recovery for the 5-day history, and Messages for the existing
   thread with the coach.
2. **Sign in as `morgan@demo.local`.** Membership page shows the Mother &
   Baby plan with "7 sessions left" and the single allowed category. On
   Schedule, the Mum & Baby class is bookable, but Strength/Cardio/General
   classes show "Not bookable: Not included in your plan (Mother & Baby)"
   — calling the booking API directly for one of those classes returns the
   same rejection from the server, not just a hidden button.
3. **Sign in as `sam@demo.local`.** Visit Schedule — note the amber
   "you don't have an active membership" banner, and that attempting to
   book is blocked with a clear message. Visit Membership and select a
   plan (since Revolut isn't configured here, this records intent only —
   the banner stays until staff activates it, or until a real Revolut
   payment confirms via webhook).
4. **Sign in as `coach@demo.local`.** Visit Classes — note the Evening
   Conditioning class is full (capacity 1) with Jordan waitlisted; try
   raising its capacity to 2 and the waitlist should auto-promote her
   (skipped automatically while her membership is still pending — activate
   her first via her member detail page to see a real promotion happen).
   Try creating a class with a past date — the form blocks it before
   submitting, and the server rejects it too. Visit Plans to see the four
   seeded plans (EUR pricing, session allowances, allowed categories).
5. **Still as `coach@demo.local`, visit Operations** (`/staff/operations`
   — first item in the nav). The member roster shows plan, status, sessions
   remaining, latest readiness, and "needs attention" badges; search by
   name/email or filter by state. Note Riley shows **"Period lapsed"** and
   Jordan likely shows **"Checkout abandoned"** if enough time has passed
   since seeding. Click **"Run housekeeping now"** — this calls the same
   endpoint a production scheduler would (`/api/cron/run`), running all
   four background jobs for real: it flips Jordan's checkout to `inactive`,
   sends Riley a real message about her lapsed period (visible in her
   Messages tab if you sign in as her), and reports per-job results in the
   Background jobs panel. Run it again immediately — both jobs correctly
   report nothing left to do, since they don't double-act once handled.
6. **Sign in as `morgan@demo.local`** and visit the new **Cycle** tab in
   the dashboard nav (visible only to her because she is cycle-eligible).
   She has cycle settings pre-filled from signup. The "Coach sharing
   preferences" section shows phase sharing is on and dates/notes are off.
   Sign in as `coach@demo.local` and open Morgan's member detail page —
   the **Cycle tracking** panel shows "Day N of ~28" (approximate, not
   medical). Open Jordan's member detail — she has cycle tracking enabled
   but all sharing off, so the panel says "Cycle tracking is private."
7. **Sign in as `taylor@demo.local`** to see the past-due state from a
   member's perspective, or `jordan@demo.local` for the pending state —
   her checkout was started a few minutes ago, so it's still locked
   ("Awaiting payment") until either 30 minutes pass or housekeeping runs.

## What's real vs. simulated

- Bookings, cancellations (with cutoff-based session restoration),
  waitlist join/leave/auto-promotion, plan/class-category eligibility,
  session allowance tracking, attendance, recovery logging, messaging, and
  staff membership overrides are fully functional against local data —
  enforced server-side, not just hidden in the UI.
- The background jobs (`lib/jobs/*`) are real, tested, and persist their
  own run history — but nothing inside the running app process triggers
  them on a timer. There's no `setInterval` anywhere; an external scheduler
  (Vercel Cron, GitHub Actions, system cron) or a staff member clicking
  "Run housekeeping now" on `/staff/operations` is what actually calls
  `/api/cron/run`. See `docs/scheduler.md` for exactly what's needed to
  schedule this in production, including the Vercel Hobby-plan caveat.
- Revolut checkout is wired to make real API calls when configured (see
  `docs/billing-revolut.md`), but no credentials exist in this
  environment — selecting a plan only records intent.
- AI coach summaries / draft replies are wired to a real endpoint but show
  an honest "not configured" message without `ANTHROPIC_API_KEY`.
- The cancellation cutoff (`CANCELLATION_CUTOFF_HOURS`, default 12) is
  real and enforced server-side on every cancellation request.
