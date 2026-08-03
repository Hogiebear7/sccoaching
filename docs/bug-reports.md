# Bug reporting — trial-period only

Lets anyone signed in submit a bug report (text + up to 3 screenshots) from
Settings; staff triage it at `/staff/bug-reports`. Built for the trial period
only. **Delete this feature entirely before full launch** — every file it
touches is listed below, tagged `TRIAL-ONLY` in a comment at the top (or, for
shared files, at the specific block/line touched).

## New files — delete outright

- `app/api/bug-reports/create/route.ts` — member submission endpoint
- `components/settings/BugReportPanel.tsx` — the Settings-page submission form
- `app/(staff)/staff/bug-reports/page.tsx`
- `app/(staff)/staff/bug-reports/BugReportsView.tsx`
- `app/api/staff/bug-reports/status/route.ts`
- `app/api/staff/bug-reports/delete/route.ts`
- `docs/bug-reports.md` — this file

## Existing files — remove the tagged block/lines

- **`lib/db.ts`**
  - `BugReportStatus` type and `BugReportRecord` interface (tagged block)
  - `bugReports: BugReportRecord[]` on the `Database` interface
  - `bugReports: []` in `readDb()`'s empty-db default
  - `bugReports: parsed.bugReports ?? []` in the parsed-db migration return
  - `MAX_STORED_BUG_REPORTS` and the four functions: `createBugReport`,
    `findAllBugReports`, `findBugReportById`, `saveBugReport`,
    `deleteBugReport`
- **`lib/permissions.ts`**
  - `"bugReports.manage"` from the `Capability` union
  - `"bugReports.manage": "coach"` from `CAPABILITY_MIN_ROLE`
  - `"/staff/bug-reports": "bugReports.manage"` from `NAV_CAPABILITY`
- **`app/(staff)/staff/layout.tsx`** — the "Bug reports" nav item
- **`app/(dashboard)/dashboard/settings/SettingsView.tsx`** — the
  `BugReportPanel` import and the "Trial feedback" section at the bottom

## Data

Existing `bugReports` rows in `data/db.json` are trial artifacts — delete the
key entirely (or just leave an empty array; either is fine once the code
above is gone, since nothing will read it).

## Why this shape

Kept deliberately separate from every other feature: its own record type, its
own API routes, its own staff page, and only two touch-points in files other
features already own (`SettingsView.tsx` for the form, `layout.tsx` for the
nav link, `permissions.ts` for the gate). Removing it is mechanical — delete
the six new files, then the handful of tagged lines above — not an
investigation.
