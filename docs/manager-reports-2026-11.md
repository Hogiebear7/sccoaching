# Manager reports: weekly and monthly briefings (spec, 2026-11-18)

**Goal:** the system reports to you. Every week and every month it works out the numbers for the gym and for the app-only business, flags what needs attention, and emails you. The same report is in the staff area, and tenants get their own gym report. Phase 1 is read-only: it never sends anything to members, refunds, cancels or changes anything.

## What already exists (and is reused, not rebuilt)

The website already has an accurate finance ledger, and every money figure in the reports comes from it:

- **Staff > Finances:** income from Stripe, Revolut and class-pass purchases, plus the entries you add by hand (Apple and Google payouts, expenses, fees), and AI cost per day. It also holds the **tax rate setting** (Finances > Settings).
- **Staff > Reports, Exports, Overview, Attendance:** members, sign-ups, memberships ended, classes, bookings, fill rate, no-shows, gone-quiet members.
- **Housekeeping jobs** (run every 15 minutes) and the email sender, including an existing monthly spreadsheet email.

The new work is a **reporting service** that composes those into one report per period, plus the email and the staff page. All arithmetic is plain code, the same way each time. No AI does any maths.

## The reports

Each report is for one gym (or the app business) and one period. **Weekly** = the last full Monday to Sunday (Irish time), a quick check-in with a comparison to the week before. **Monthly** = the last full calendar month, the same figures plus a longer breakdown and a comparison to the month before.

### Gym report (everyone with a gym: you and each tenant)
- Booked in for classes overall, attended, no-shows, fill rate
- Bookings per class type
- Busiest hours (top three start times by bookings)
- New sign-ups, class passes bought, memberships ended (lost members)
- Total members, current members, paused members, pass holders
- Members who have gone quiet (14 days with no class or logged session)
- Things to look at (see below)

### Money section (you only, for the S&C gym)
- Total income, and income per type (membership, class pass, other)
- Income per source (Stripe, Revolut, cash, and so on)
- Fees, expenses entered, and the **monthly balance** (income minus fees minus expenses)
- **Tax set aside:** the Finances tax rate (23% unless you change it in Staff > Finances > Settings) applied to the balance, the same way Staff > Finances works it out. It is an estimate, not tax advice, and never below zero.
- AI cost for everyone who is not an App Subscription user: total and average (per AI call, and per member who used AI), in euro. The balance takes it off. AI cost for App Subscription users goes in the app report instead, so nothing is counted twice.

### App-only report (you only)
- Total users (all accounts), App Subscription holders by store (Apple, Google, complimentary)
- Plans bought in the period (monthly or yearly), trials started, trials ended without converting
- Income (the Apple and Google payouts you enter in Finances), the Apple and Google cut (fees entered), AI cost total and average for App Subscription users, tax set aside, balance (income minus the cut minus AI cost)
- **Downloads:** not available (see below)

### Platform section (you only)
- One line per gym on the platform: members, new sign-ups, bookings, classes. No tenant money. Tenant billing is not live, so money stays out of their reports and out of this section.

### Things to look at (rules, not AI)
Members who have gone quiet, failed, refunded or pending payments, a fall of more than 20% in bookings or sign-ups against the previous period, a no-show rate of 15% or more, class types under 30% full, and more memberships ending than starting. (Passes about to expire and busiest-day patterns are not in phase 1.)

## Where it appears
1. **Email:** weekly on Monday morning (about 7am Irish time), monthly on the 5th (so Apple and Google payouts have been entered), to platform owners and gym managers. Once per person per period. Set `MANAGER_REPORTS_EMAIL=off` on Hostinger to stop them.
2. **Staff area:** a new **Briefings** page under Business, with a weekly and monthly switch and the last 12 periods. The money, app and platform sections only show for the platform owner.
3. **Tenants:** their gym managers get the gym report only, scoped to their own gym.

## Data gaps (stated in the report itself, not hidden)
- **Downloads from Apple and Google:** the stores do not send us these. Connecting them means an App Store Connect API key and a Google Play reporting export. Not part of phase 1.
- **App income:** comes from what you enter in Staff > Finances. If nothing is entered for a period the report says so.
- **Lost members and trials ended:** the system stores each member's current status, not a history, so these are close approximations using the last change date. Staff > Overview uses the same method.
- **Tenant money:** excluded until tenant billing exists.

## Phase 2 (not built yet)
- AI-written commentary on top of the numbers (aggregate figures only, never names or health data)
- Store download numbers
- Per-tenant revenue share, once tenants pay through the platform

## Decisions already made
- Read-only first, no automatic actions
- Tax rate stays 23% and is changed in Staff > Finances > Settings
- Reports for tenants are their own gym only, with no money

## Status (2026-11-18)

Built on the branch `feat/manager-reports` of the website repo, tested, **not merged and not deployed**. Nothing is emailed until it is merged and deployed.

- Pure calculations and the email timing have automated tests; the full existing test suite still passes.
- The report builder was run end to end against a throwaway two-gym test datastore (never real data).
- Email timing: weekly on Monday or Tuesday from 07:00 Irish time; monthly from the 5th to the 12th. Each person gets each period's email once.
- To change the tax rate: Staff > Finances > Settings. To stop the emails: set `MANAGER_REPORTS_EMAIL=off` on Hostinger.
