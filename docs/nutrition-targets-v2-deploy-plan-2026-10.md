# Nutrition targets v2 — production deploy plan (2026-10-25)

Status: **approved 2026-10-25.** Step 1 done on local `release/nutrition-v2`: 2,968 tests pass, typecheck clean, no lint errors in changed files, `next build --webpack` succeeds with both new routes. Steps 2–3 (owner) next; nothing pushed.

Goal: get nutrition targets v2 onto the live server, so that phone build 81
shows everything (the seven screen changes and the crash fixes, which need no
server change, plus v2, which does).

This follows `docs/deployment-operations.md` and the production datastore rules:
- back up and checksum before any deploy;
- the owner confirms every deploy in hPanel;
- nothing is deployed, redeployed or rolled back without explicit approval each
  time.

## What ships

**The six v2 commits only:**

| Commit | Content |
|---|---|
| `5d45b62` | Slice A: engine and plan |
| `bcab3d4` | Slice B: preferences, day marks, coach lock |
| `bbb33df` | Slice C: resolver |
| `3d8a7d4` | Activity level |
| `9db04fd` | Plan status |
| *(this file)* | Deploy plan |

**Not shipped:** the 8 member-area website commits (`redesign/member-area`,
unreviewed, not approved for push). The v2 commits share no files with them, so
they apply cleanly on their own; this was checked by comparing changed files.

**Server changes (additive only):**
- 2 new member routes:
  - `/api/mobile/nutrition/preferences`
  - `/api/mobile/nutrition/diary/day-status`
- New fields on 3 existing routes:
  - target
  - targets/week
  - diary
- 2 existing routes now preserve the coach distribution fields:
  - staff nutrition-target update
  - member-override
- 1 new collection, `nutritionDayStatuses`, created empty on first read.
- New optional fields on profiles and on coach nutrition targets.
- No migration and no script. Existing records are read with defaults.

**Behaviour change members will see:** automatic calorie targets switch to
weekly budgets the first time they open the app after the deploy. Coach-set
(manual) and disabled targets are untouched.

## Steps

### 1. Prepare the release branch (agent, local only)

1. Create local branch `release/nutrition-v2` from
   `origin/redesign/index-html-blueprint` (currently `7755665`).
2. Cherry-pick the v2 commits onto it.
3. Run the full test suite, `tsc --noEmit` and lint.
4. Run `next build --webpack` locally, matching the Hostinger build. This catches
   build errors before Hostinger does. The two load-bearing settings must still be
   in place: `next.config.mjs` and `--webpack`.
5. Report the results. Nothing is pushed in this step.

### 2. Owner: confirm what is live today (hPanel, read-only)

1. **hPanel → Deployments:** note the Current deployment's commit hash.
   - The plan assumes it is `7755665`.
   - If it is anything else, stop: the release branch would need rebasing onto
     that commit, or production is running something not on GitHub.
2. Note the hPanel entry that will be the rollback target. That is the current one.

### 3. Owner: back up the datastore (immediately before step 4)

On the server, in `DATA_DIR`:

```
cp -p db.json ~/backups/db.json.pre-nutrition-v2-$(date +%Y%m%d-%H%M%S)
chmod 600 ~/backups/db.json.pre-nutrition-v2-*
sha256sum db.json ~/backups/db.json.pre-nutrition-v2-*
ls -l db.json ~/backups/db.json.pre-nutrition-v2-*
```

- Keep the checksum, size and timestamp.
- Don't delete earlier backups.
- Don't run any `scripts/*.mjs` operator scripts during the deploy window.

### 4. Push: the deploy itself (agent, only on the owner's explicit "push now")

Fast-forward `redesign/index-html-blueprint` to `release/nutrition-v2` and push.
Hostinger auto-builds on push. No force-push: it is a fast-forward from
`7755665`.

### 5. Owner: verify the deployment (`deployment-operations.md` §7)

1. hPanel → Deployments: the new entry is **Completed** and **Current**, and its
   commit hash matches the pushed head.
2. The build log has no errors.
3. The runtime log shows no startup errors.

### 6. Smoke test (owner's phone with the current app, plus build 81)

**Current app, before build 81:**
- Sign in, then open Nutrition.
  - The day's calories show.
  - The targets screen loads.
  - Food logs as normal.
- Staff view: open a member's nutrition target; it loads and saves (Auto mode).

**Build 81 (agent builds once step 5 passes):**
- The targets screen shows "This week" and the distribution, pace and activity
  settings. Changing one saves and updates the number.
- The diary shows "Logged everything you ate?". Marking a day complete, then
  Undo, works.
- Settings → Calorie targets opens the screen.
- Staff: in Auto mode, set a distribution and lock it. The member's screen then
  shows the lock.
- Plus the earlier build-81 checks: workout cards, session detail, history,
  community likes and comments, weight entries, 4 default sets, rest timer (no
  crash), targets week view.

Use your own and test accounts only. Don't change a real member's settings
unless you mean to.

## Rollback

**Code:** hPanel → redeploy the deployment noted in step 2, then re-run §7.

**Data:**
- v2 writes only new optional fields, and new rows in `nutritionDayStatuses`.
- **Kept on rollback:** members' pace, distribution and activity choices, and
  coach locks. The old code copies unknown fields on profiles and targets through
  untouched (`{ ...p }` / `{ ...t }` in its normaliser, checked against
  `origin/redesign/index-html-blueprint`). They would simply be ignored until v2
  is redeployed.
- **Lost on rollback:** the "Day complete" marks. The old normaliser lists
  collections explicitly, so the next write drops `nutritionDayStatuses`.
- Nothing else is affected: no existing field changes meaning.
- Restoring the step-3 backup is only needed if something else went wrong. It
  would also roll back every real change members made after the deploy, so it is
  a last resort.

## Risks

- **Members' auto targets change.** Mostly upwards for people who under-log, and
  they become weekly. Consider a short message to testers ("your targets now
  update weekly — mark days complete to sharpen them").
- **Multi-process overlap:** the datastore is one unlocked file. The deploy
  restarts the app, and Hostinger may overlap processes briefly. This risk is
  unchanged from every previous deploy; the step-3 backup is the mitigation.
- **Build-host quirks:** covered by step 1.4 (the local webpack build).
- **Branch history:** `redesign/member-area` stays local and unpushed. Merging it
  later will need a normal rebase onto the new head; the files don't overlap.

## What needs the owner

| Step | Who |
|---|---|
| 2, 3, 5 | Owner (hPanel / server access, which the agent doesn't have) |
| 4 | Agent, but only after the owner says "push now" following step 3 |
| 1 | Agent, local, once this plan is approved |
| Build 81 | Agent, after step 5 passes |
