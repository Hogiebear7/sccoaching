# Onboarding Schema

## Overview

We are adding a login/sign-up flow for clients.

On sign-up, users will enter their profile information. That information will then populate the Info tab of their profile inside the app.

If a user selects Female as their gender, they will be given the option to opt in to cycle tracking. If they opt in, they can then choose what cycle information is visible to their coach.

Cycle tracking is for educational fitness guidance, not medical advice.

Suggested cycle tracking prompt:

**Would you like to use cycle tracking in the app?**  
Track patterns, symptoms, and phases to support training, recovery, and coach guidance.

---

## Required profile fields

These must be completed during onboarding:

- Name
- Email
- Phone
- Gender
- Goals

---

## Optional profile fields

These can be completed if known or relevant:

- Current Weight
- Additional Info

Suggested placeholder text for Additional Info:

`Any other info, injuries etc`

---

## Gender field

Type: dropdown or segmented select

Options:
- Male
- Female
- Other

Logic:
- If Gender = Female, show cycle tracking opt-in question
- If Gender = Male or Other, do not show cycle tracking section in v1

---

## Goals field

Type: pre-populated dropdown

Options:
- Weight Loss
- Build Muscle
- Maintenance
- Injury Recovery
- Sports Performance
- General Health
- Improve Fitness
- Improve Mobility

Logic:
- If Goals = Sports Performance, show an additional required field:
  - Sport Played

---

## Conditional fields

### Sports performance
Only shown if:
- Goals = Sports Performance

Field:
- Sport Played (required)

### Cycle tracking
Only shown if:
- Gender = Female

First question:
- Would you like to use cycle tracking in the app?

Support text:
- Track patterns, symptoms, and phases to support training, recovery, and coach guidance.

If user selects Yes:
Show the cycle tracking fields and privacy settings.

If user selects No:
Skip cycle setup and continue onboarding.

---

## Cycle tracking fields

Only shown if:
- Gender = Female
- and cycle tracking opt-in = Yes

Fields:
- First day of last period
- Average cycle length (days)
- Period length (days)
- Regularity
- Notes (private)

Regularity options:
- Regular
- Irregular
- Unsure

Notes field:
- Private by default
- Not shown to coach unless explicitly shared in a later permission rule

---

## Cycle privacy controls

Only shown if cycle tracking is enabled.

Fields:
- Share current phase with coach
- Share exact dates with coach
- Share notes with coach

Recommended defaults:
- Share current phase with coach = Off
- Share exact dates with coach = Off
- Share notes with coach = Off

Privacy principle:
- Dates and notes stay private by default
- The client chooses what, if anything, the coach can see

---

## Coach visibility rules

### Always visible to coach
- Name
- Email (if operationally needed)
- Phone
- Goals
- Sport Played (if applicable)
- Current Weight (if entered)
- Additional Info (if intended for coach use)

### Only visible if client opts in
- Current cycle phase
- Exact cycle dates
- Cycle notes

### Private to client by default
- Last period start date
- Raw cycle information
- Private notes

---

## Data structure

### users
Authentication record handled by auth provider

Fields:
- id
- email
- password / auth provider credentials
- createdAt
- updatedAt

### profiles
Main member profile record

Fields:
- userId
- fullName
- email
- phone
- gender
- primaryGoal
- sportPlayed
- currentWeightKg
- additionalInfo
- cycleTrackingEligible
- cycleTrackingEnabled
- onboardingCompleted
- createdAt
- updatedAt

### cycle_settings
Cycle data record

Fields:
- userId
- lastPeriodStartDate
- averageCycleLengthDays
- periodLengthDays
- regularity
- privateNotes
- createdAt
- updatedAt

### cycle_privacy_preferences
Cycle sharing permissions

Fields:
- userId
- shareCurrentPhaseWithCoach
- shareExactDatesWithCoach
- shareNotesWithCoach
- createdAt
- updatedAt

### optional future table: cycle_log_entries
For a fuller cycle history later if needed

Fields:
- id
- userId
- eventType
- eventDate
- note
- createdAt

---

## Validation rules

### Required
- fullName
- email
- phone
- gender
- primaryGoal

### Optional
- currentWeightKg
- additionalInfo

### Conditional
- sportPlayed is required only if primaryGoal = Sports Performance
- cycle tracking fields only show if Gender = Female and cycle tracking = Yes

### Suggested validation
- fullName: min 2 characters
- email: valid email format
- phone: valid phone format
- currentWeightKg: positive number if entered
- sportPlayed: non-empty if required
- averageCycleLengthDays: integer, sensible range
- periodLengthDays: integer, sensible range
- privateNotes: max length limit

---

## Signup flow

### Step 1: Welcome
Purpose:
- Let the client choose Sign in or Create account

Actions:
- Sign in
- Create account

---

### Step 2: Account setup
Fields:
- Email
- Password
- Confirm password

---

### Step 3: Basic profile
Fields:
- Full Name
- Phone
- Gender
- Current Weight (optional)

---

### Step 4: Goals and context
Fields:
- Goals
- Sport Played (only if Sports Performance)
- Additional Info

---

### Step 5: Cycle tracking
Only shown if:
- Gender = Female

Fields:
- Cycle tracking opt-in
- Benefit description
- If opted in:
  - First day of last period
  - Average cycle length
  - Period length
  - Regularity
  - Notes
  - Privacy toggles

---

### Step 6: Review and create account
Purpose:
- Show user a summary before account creation

Sections:
- Basic profile
- Goal
- Sport if relevant
- Optional weight
- Additional info
- Cycle tracking summary if enabled
- Privacy choices if enabled

Actions:
- Back
- Create account

---

## Route structure suggestion

/app
  /(auth)
    /login/page.tsx
    /signup/page.tsx
  /(member)
    /app/page.tsx
    /app/profile/page.tsx

---

## Recommended implementation notes

- Save planning and schema notes in `docs/onboarding-schema.md`
- Put TypeScript types in `lib/profile-schema.ts`
- Put dropdown options in `lib/profile-options.ts`
- Build the signup UI in `app/(auth)/signup/page.tsx`
- Build the login UI in `app/(auth)/login/page.tsx`

---

## Summary of final onboarding logic

Always ask:
- Name
- Email
- Phone
- Gender
- Goals

Only ask if relevant:
- Sport Played
- Cycle tracking
- Cycle settings
- Cycle privacy controls

Optional:
- Current Weight
- Additional Info