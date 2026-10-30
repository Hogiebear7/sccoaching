# Admin area revamp plan, 2026-10-29

Owner request (2026-10-27, restated 2026-10-29): make the admin area (website first, then the app) as fluid, professional and easy to
use as possible, with figures exported to several spreadsheets plus a master spreadsheet. The owner approved working through this
without stopping for approval while they were out; each slice still ships tested, in small steps.

## What the research says (summary)

- **Few numbers, reviewed on a rhythm.** Gym-software vendors and owner guides agree on a short list: active members, new and lost
  members (churn), retention, attendance and visit frequency, class fill rate and no-shows, and revenue per member. Five to seven KPIs
  beat twenty; sprawling dashboards get abandoned. Weekly: active members, churn, attendance. Monthly: retention, revenue per member.
  ([Clubworx](https://www.clubworx.com/blog/gym-member-metrics-to-track), [GymMaster](https://www.gymmaster.com/blog/metrics-every-gym-ower-should-track/),
  [Glofox](https://www.glofox.com/blog/gym-management-software-reporting-for-owners/), [FitBudd](https://www.fitbudd.com/insights/what-is-gym-analytics-software-key-reports-kpis))
- **Attendance is the early warning.** Members who stop coming for two weeks are the highest churn risk; members training twice a week
  stay far longer. The admin area should surface "hasn't trained in 14 days" as a list to act on, not just a number.
- **Tables: one filter bar, honest exports.** Search plus filter chips and a clear "reset"; filters chosen by data type (status chips,
  date ranges). Exports live next to the data they export, say exactly what they contain ("1,240 rows matching your filters"), and
  respect the current filters. ([SaaS export patterns](https://www.saasui.design/blog/saas-data-export-download-ux-patterns),
  [data table practice](https://uxplanet.org/best-practices-for-usable-and-efficient-data-table-in-applications-4a1d1fb29550))
- **Don't render everything at once.** Paginate long tables; keep heavy filter panels from pushing the data below the fold.

## Where the admin area is today

Website `/staff`: Overview (operations calendar), Classes, Workouts, Members, Attendance, Messages, Exercise Library, Memberships &
Pricing (catalog), Reports, Finances (platform operator only), Staff, Food Reviews, Community reports, Bug reports. The app has a
smaller staff area (members, classes, messages, business).

Strengths: per-gym scoping is enforced on the server everywhere; the member page now has one clear "Membership & access" panel; member
lists default to the gym's own members, with stars.

Gaps: no single "today" view with the numbers that matter; tables each work differently; no spreadsheet export anywhere; no at-risk
list; reports show charts but nothing to take away.

## Target shape

1. **Today** (the landing page): 6 KPI tiles (active gym members, new this month, ended this month, paused, classes this week with
   average fill, no-shows this month), each with last month's figure beside it; an **At risk** list (gym members with no class or logged
   session in 14 days, newest first, one tap to message); today's classes with spaces left.
2. **Members**: one table (search, group filter, plan, status, starred), bulk actions, export of exactly what's shown.
3. **Classes & attendance**: schedule plus fill rate and no-show trends per class type.
4. **Reports & exports**: every sheet as CSV or Excel, and the **master workbook** with all of them plus a Summary sheet.
5. **Money** (platform operator): the finance ledger and App Subscription figures, exportable.
6. **Settings**: staff, catalog, gym details.

Design rules: the DESIGN.md palette and type; one filter bar pattern; numbers right-aligned with tabular figures; every destructive or
billing-affecting action confirms; every table paginates; works at phone width.

## Slices

- **S1 (done 2026-10-29): Exports.** A Reports & exports page with sheets for Members, Memberships, Classes, Bookings and App access & AI, as
  CSV or Excel, plus the master workbook (all sheets and a Summary). Gym-scoped, admin only (reports.view). Spreadsheet-formula
  injection guarded. Tests.
- **S2 (done 2026-10-29): Today figures and At risk**, at the top of the staff Overview: six figures for the month so far, each against the same days last month, and the At-risk list.
- **S3 (done 2026-10-30): Shared table component** (`components/staff/DataTable.tsx`: search, chips, sort, pages, "Export this view" as CSV). Attendance is rebuilt on it (last 30 days, all time, last class; "No class in 14 days" and "Never attended" filters). Members already had search, filters, sorting and pages, so it gained "Export this view" rather than a rebuild.
- **S4 (done 2026-10-30): The app's staff area** gets Today and At risk: a card at the top of the staff Classes screen (`/api/mobile/staff/today`, the same numbers as the website). Admins and up; hidden for coaches. Needs the next app build.
- **S5 (done 2026-10-29): Monthly master workbook by email.** In the first week of each month, every admin manager (and platform operator) gets last month's workbook for their gym, with the summary in the email and an in-app notice. Exports also gained a "Last month" period.
- **S6 (done 2026-10-30): Staff changes.** Every staff change to a member is recorded (free App Subscription and gym Membership grants and withdrawals, single and bulk; AI pause and resume; membership pause, resume and status overrides; extra classes; archive, restore, delete) with who, to whom and when. A Staff changes page (`/staff/changes`, admin) and a "Staff changes" sheet in the exports and the master workbook. Changes made before this date were not recorded.
