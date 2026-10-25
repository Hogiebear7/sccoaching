# Nutrition targets v2 — plan (2026-10-25)

Status: **approved 2026-10-25.** Slices A–C done; D–F to follow, each paused for review.

## Why

A tester's daily calorie target came out very low. The current engine
(`lib/nutrition-target.ts`, `lib/nutrition-target-data.ts`) has five behaviours
that stack downwards:

1. **Partial food days count as full days.** The adaptive expenditure averages
   every day with any food logged. Missed snacks and meals look like "ate little,
   weight held", so expenditure is learned too low.
2. **The learned number is refitted from scratch** over the last 28 days, so it can
   jump when the regime switches.
3. **The whole target is recalculated daily**, including a "you ate over yesterday"
   cut of up to 250 kcal.
4. **Rest days use the lowest multiplier** and nothing keeps the week's total right.
5. **The floor is 18 kcal/kg** (about 1,080 kcal at 60 kg), and a "Weight loss" goal
   without a date takes a flat 20% off.

## Decisions (agreed with the owner in chat)

| Area | v2 behaviour |
|---|---|
| Incomplete food days | Copy MacroFactor: only complete days teach the expenditure estimate |
| Learned expenditure | Copy MacroFactor: smoothed, moves gradually week to week |
| How often the target changes | Weekly budget set at a Monday check-in; each day's share is planned in advance; no next-day "overeating" cut |
| Training days | Kept, inside the fixed weekly budget, capped at ±20% of the daily average |
| Goal without a date | Weekly pace instead of a flat 20% |
| Minimum | Raised, and shown to the member when it applies |
| Who chooses the distribution | The member, in the app; a coach can set a default or lock it |
| Upsell nudge | One-time tip to try training-linked calories for regular trainers |

## The rules

### 1. Which food days count ("complete days")

A day teaches the expenditure estimate only if it is complete:

- **Marked complete** by the member ("Day complete" in the diary), **or**
- **Looks complete**: food in at least 3 meal slots **and** at least 60% of that
  day's target, **and**
- **never** if the member marked it incomplete.

Days with no food are always ignored. Days that don't count still show normally in
the diary; they just don't feed the estimate.

### 2. Expenditure (how much they burn)

- **Starting estimate (formula):** Mifflin-St Jeor resting burn when height and date
  of birth are on file, otherwise the existing bodyweight heuristic. This is multiplied
  by an activity factor from the member's weekly training plan, averaged over the week
  (not per day).
- **Trend weight:** an exponentially smoothed weight (α = 0.1) over weigh-ins, carried
  forward across missing days. Several weigh-ins on the same day are averaged.
- **Learning, once a week at each Monday check-in:**
  - The **observed** burn = average intake on complete days − (trend change over the
    last 14 days × 7,700 ÷ 14).
  - It needs at least 7 complete days and at least 4 weigh-ins in those 14 days;
    otherwise the estimate carries forward unchanged.
  - New estimate = previous + 25% × (observed − previous), with the weekly move capped
    at ±150 kcal.
  - Observed values outside 1,200–6,000 kcal are ignored.
- **Calculation method:** the estimate is recomputed from full history on each request,
  walking Monday by Monday. It is deterministic, so nothing new is stored, and any
  date's value can be reproduced.
- **What the member sees:** "Estimated" until the first learned week, then "Learned
  from your logs".

### 3. Goal pace

- **New profile field** `goalPacePctPerWeek`, signed % of bodyweight per week:
  - Lose: −0.25 Gentle · −0.5 Moderate · −0.75 Faster · −1.0 Maximum.
  - Gain: +0.25 Lean · +0.5 Faster.
  - Maintain: 0.
- **Defaults when unset:** "Weight loss" → −0.5, "Build muscle" → +0.25, anything
  else → 0.
- **Members with a goal weight and date but no pace:** keep today's behaviour, where
  the pace is derived from the timeline and clamped. No data migration is needed.
- **Daily adjustment** = pace × bodyweight × 7,700 ÷ 7.
- **Shown date:** "at this pace you'd reach X around <date>".
- **Retired:** the flat 20%/10% goal bias.
- **Gain cap:** raised from 0.25% to 0.5% per week, only so the "Faster" gain option
  exists.

### 4. Weekly budget and the minimum

Weekly budget = 7 × (expenditure + daily goal adjustment), set at the Monday check-in
and frozen for that week.

**Minimum daily average** is the highest of:

- 1,200 kcal (Female) / 1,500 (Male) / 1,350 (Other)
- the estimated resting burn
- 75% of expenditure

If the minimum applies, the pace is slowed to fit. The member sees "We've slowed your
pace to keep your target at a safe level", and the response carries `paceLimited: true`.

**No single day** goes below the sex floor, even on a rest day.

**Coach manual targets** (mode "manual") are unchanged and bypass all of this, as today.

### 5. Distributing the week

| Setting | What happens |
|---|---|
| **Same every day** (`even`) | Budget ÷ 7 every day |
| **Match my training** (`training`) | Each day is weighted by its planned exertion — Reduced 0.9 · Standard 1.0 · Full 1.1 · Match 1.2 — then clamped to 0.8–1.2 of the daily average and rescaled so the week still sums to the budget |

- **Luteal phase** (cycle tracking on): +120 kcal on luteal days, taken evenly from
  the other days, so the weekly total is unchanged.
- **Macros:** protein stays constant (g/kg). Fat follows the day's band. Carbs fill
  the rest, so carbs carry most of the day-to-day swing.
- **Planned days:** shares come from the weekly training plan, so a member can see
  the whole week on Monday.
  - **Known limitation:** editing the plan mid-week reshuffles the rest of the week,
    and can also change how past days of that week are displayed, because nothing is
    stored. A stored weekly snapshot would fix this, but needs a new collection; it is
    deferred.
- **Removed:** the daily "ate over yesterday" adjustment.

### 6. Who decides the distribution

The first rule that applies wins:

1. A coach **lock** (`NutritionTargetRecord.distributionLocked = true`) → the coach's
   `distribution`.
2. The member's choice (`profile.calorieDistribution`).
3. The coach's default (`NutritionTargetRecord.distribution`, not locked).
4. The tier default: Membership tier → `training`; App subscription / Free → `even`.

A member's change takes effect from the next day; today's number never changes
mid-day.

## Worked example (tester-like profile)

Female, 60 kg, 165 cm, 30 years old, goal "Weight loss", no goal date, three
moderate gym sessions a week, logs about 1,300 kcal on days with missed snacks,
weight steady.

**Today:**
- Once adaptive kicks in, learned burn ≈ 1,300 (partial days taken as real).
- × 0.8 = 1,040, raised to the 1,080 floor → **about 1,080 kcal**.

**v2:**
- **Burn:** partial days don't count, so she stays on the formula: resting burn
  1,320 × the week's fuel-day multiplier.
  - The existing fuel bands smooth each day over yesterday and tomorrow, so three
    moderate sessions make every day a "Reduced fuel day" (×1.33).
  - Expenditure ≈ **1,760**.
- **Pace:** Moderate −0.5% → −330 kcal/day → average **1,430**.
- **Minimum:** max(1,200, 1,320, 1,320) = 1,320. The average is above it, so
  nothing changes.
- **Same every day:** 1,430.
- **Match my training:** about 1,517 on gym days and 1,365 on rest days. The split
  uses each day's own session, not the smoothed band.
- If she marks days complete, the estimate then learns from what she actually eats.

**Correction found in slice C:** this section first said 1,650. That assumed
moderate sessions were "standard" fuel days, which they aren't under the
existing bands. A known open point is whether to add a MacroFactor-style activity
question so the starting burn isn't capped by the fuel-band calibration; that is
for the owner to decide.

## Data changes (all additive and optional — no migration)

- `ProfileRecord`: `goalPacePctPerWeek?: number | null`,
  `calorieDistribution?: "even" | "training" | null`.
- `NutritionTargetRecord`: `distribution?: "even" | "training" | null`,
  `distributionLocked?: boolean`.
- **New member-owned collection** `nutritionDayStatuses`:
  `{ id, userId, date, status: "complete" | "incomplete", updatedAt }`.
  - Add it to member data export and account deletion (`MEMBER_OWNED_COLLECTIONS`).
  - This is the only new collection. It follows the production datastore safety rules:
    backup and checksum before the deploy that introduces it.

## API changes (additive; the existing web dashboard keeps working)

- `GET /api/mobile/nutrition/target` and `/targets/week` gain these fields:
  - `distribution`, `distributionSource` (`coach-locked | member | coach | default`)
  - `weekStart`, `weekBudget`, `expenditure`, `expenditureSource` (`formula | learned`)
  - `completeDaysLast14`, `pacePctPerWeek`, `paceLimited`, `minimumApplied`
- New `POST /api/mobile/nutrition/preferences` `{ calorieDistribution?, goalPacePctPerWeek? }`:
  - self-owned only;
  - rejects a distribution change while the coach lock is on;
  - validates pace values.
- New `POST /api/mobile/nutrition/diary/day-status` `{ date, status: "complete" | "incomplete" | null }`:
  self-owned only.
- `POST /api/mobile/staff/nutrition-target/update` accepts `distribution` and
  `distributionLocked`, with the same checks as today:
  - `can(role, "nutrition.manage")`
  - `sameGym`
  - `staffCanViewMemberData`
- The `rationale` lines are rewritten for the new rules, and `lib/ai-context.ts`
  (the AI coach's context) is checked so it describes them correctly.

## UI changes

**Mobile (sc-coaching-mobile):**
- **Calorie and macro targets screen:**
  - "Calorie distribution" control (Same every day / Match my training); when locked,
    it shows "Set by your coach".
  - Weekly budget and "updates every Monday" line.
  - "Estimated / Learned from your logs" status, with a 2-week learning note.
  - Pace-limited message when the minimum applies.
- **Nutrition diary:** "Day complete" toggle on the day; an incomplete marker in its
  menu.
- **Settings → Nutrition:** shortcut to the same distribution setting, plus the pace
  picker.
- **Onboarding:** a pace step (replacing the date-led step for weight goals) and a
  distribution step.
- **Training tip:** shown once when a member on `even` has logged at least 3 workouts
  a week for 3 weeks running: "You're training regularly — want your calories to match
  your training days?" Dismissal is stored on the device.
- **Staff member nutrition screen:** distribution default and lock switch.

**Web:**
- The member nutrition page shows the new fields read-only (rationale text plus
  distribution).
- The staff web editor for lock and default is a follow-up slice, not part of v2's
  first pass.

## Slices (each one: implement → narrow checks → report → pause)

| Slice | Scope |
|---|---|
| **A. Engine** | Pure functions in `lib/nutrition-target.ts`, with unit tests, for complete days, trend weight, smoothed expenditure, pace, floor, weekly budget and distribution. Includes the worked example as a test. |
| **B. Data and routes** | Optional fields, the `nutritionDayStatuses` collection, the preferences and day-status routes, and the staff update fields. Tests include self-owned and cross-gym denial cases (tenant checklist). |
| **C. Wiring** | The resolver uses the A engine; additive API fields; rationale and AI-context text. Existing tests updated, plus a local curl smoke test of target and week. |
| **D. Mobile targets, diary, settings, tip** | Typecheck, lint, tests. |
| **E. Mobile onboarding and staff lock** | Typecheck, lint, tests. |
| **F. Device test** | One EAS build against a local or staging server. The phone app talks to the live server, so v2 can only be tried on the phone after the server change is deployed (see Deploy). |

## Deploy (separate approval, not part of this plan)

- Server first: backup and checksum `db.json`, as the production datastore safety rules
  require.
- Then the mobile build.
- Existing members' targets change at their next Monday check-in. A one-line in-app
  note explains: "Your targets now update weekly."

## Branches

- **gym-app:** new branch `feature/nutrition-targets-v2` from the current
  `redesign/member-area` tip (local, unpushed), so it carries the member-area nutrition
  page it edits.
- **sc-coaching-mobile:** continue on `redesign/app-dashboard-prototype`.
- Nothing is pushed.

## Risks and open points

- **Real members' numbers will change.** Mostly upwards for under-loggers, and they
  stop moving daily. That is intended, but it is visible.
- **The "looks complete" heuristic is a guess.** The 3 meal slots and 60% thresholds
  are tunable constants.
- **The stored weekly snapshot is deferred** (see the known limitation in rule 5).
- **The minimum is general guidance, not medical advice.** Coach manual targets can
  still go lower; keeping that matches today's behaviour.
- **Faster weekly pace with lower weekly volume** is not modelled; the luteal and
  training adjustments are deliberately small.
