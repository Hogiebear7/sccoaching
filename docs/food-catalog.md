# Food catalog — schema, API, and mobile integration

A MacroFactor-style food logging system: grouped search (History / Custom /
Common / Branded), barcode scanning with an Open Food Facts fallback, a
label-scan contract for future OCR, and a moderation + OFF-submission
workflow. Everything downstream of ingestion deals in one normalized
`FoodRecord` shape — no route or component ever touches a raw vendor payload.

## Design decisions

- **One schema, three stored domains.** `FoodRecord` is reused across three
  separate collections in `lib/db.ts` — `customFoods`, `commonFoods`,
  `brandedFoods`. This satisfies "separate backend concepts" (grouped search,
  independent moderation) and "single internal schema" (one shape, one set of
  gram-math functions) at the same time.
- **History is derived, not stored.** There's no `history` collection. A food
  counts as "history" if the member has previously logged a diary entry that
  resolves to it (`foodId` + `foodDomain` on `FoodEntryRecord`). Computed at
  search time in `getFoodHistory()` — avoids a second source of truth for
  "was this logged before."
- **Canonical nutrition is per 100g.** `FoodNutrition100g` always stores
  per-100g values. `FoodServing { label, grams }` is a labelled gram
  conversion layered on top; `gramsForServing()` / `nutritionForGrams()` do
  the scaling. These two functions are ported byte-identical into the mobile
  app (`src/lib/queries/food-catalog.ts`) so the client-side serving preview
  always matches what the server would compute.
- **Never expose a raw vendor payload.** `lib/open-food-facts-client.ts` is
  the only file that reads Open Food Facts' JSON shape.
  `normalizeOpenFoodFactsProduct()` in `lib/food-catalog.ts` is the only
  function that touches an `OpenFoodFactsProduct` object. Every API route and
  everything on mobile deals exclusively in `FoodRecord`.
- **Diary entries snapshot, never reference live.** `FoodEntryRecord` stores
  the calories/macros computed at log time, plus optional
  `foodId`/`foodDomain`/`servingLabel`/`servingGrams`/`quantity`. Editing a
  catalog food's nutrition later never rewrites historical diary entries.
- **OCR is a pluggable, currently-unconfigured adapter.** No OCR vendor
  credentials exist in this repo. `lib/ocr-provider.ts` defines the contract;
  the shipped implementation always returns `configured: false`, and the
  label-scan route returns `501 { code: "ocr_not_configured" }`. The contract
  (request/response shape, image validation, heuristic text parser) is real
  and ready for a provider to be wired in.
- **OFF submission is eligibility-gated, opt-in, and reviewed before any live
  write.** A custom food only becomes `eligible_for_submission` once it has a
  brand name and barcode (name/serving/macros are already required to create
  a custom food at all — see `lib/food-submission.ts`). Submitting requires
  explicit consent and lands at `pending_review`; a staff member approves or
  rejects it. Approval only attempts a live Open Food Facts write if
  `isOffLiveWriteEnabled()` is true — which requires both an env flag and a
  configured provider, neither of which exist in this repo. Otherwise the
  record simply stays `approved`. The workflow is real and resumable, not
  simulated — see "Food submission workflow" below.

## Database schema (`lib/db.ts`)

```ts
type FoodDomain = "custom" | "common" | "branded";
type FoodProvenance = "user" | "open_food_facts" | "admin" | "usda_seed";

interface FoodServing { label: string; grams: number; }

interface FoodNutrition100g {
  calories: number; proteinG: number; carbsG: number; fatG: number;
  fiberG: number | null; sugarG: number | null; sodiumMg: number | null; saturatedFatG: number | null;
}

interface FoodRecord {
  id: string; domain: FoodDomain; name: string; brandName: string | null; barcode: string | null;
  nutrition100g: FoodNutrition100g; defaultServing: FoodServing; servings: FoodServing[];
  provenance: FoodProvenance; sourceRef: string | null; verified: boolean;
  region: string | null;       // OFF's raw country-tag string, or an admin-set ISO alpha-2
  ownerUserId: string | null;  // set for domain "custom", null otherwise
  archivedAt: string | null; createdAt: string; updatedAt: string; fetchedAt: string | null;
}

type FoodModerationStatus = "open" | "resolved" | "dismissed";
interface FoodModerationRequest {
  id: string; userId: string; barcode: string | null; queryText: string | null; note: string | null;
  status: FoodModerationStatus; resolvedFoodId: string | null; resolvedByStaffId: string | null;
  createdAt: string; updatedAt: string;
}

type FoodSubmissionStatus = "pending_review" | "approved" | "rejected" | "submitted_to_open_food_facts" | "failed";
interface FoodSubmissionRecord {
  id: string; userId: string; customFoodId: string; status: FoodSubmissionStatus;
  consentGiven: boolean; consentedAt: string | null;
  frontPhotoUrl: string | null; labelPhotoUrl: string | null;   // optional, inline data URLs
  reviewedByStaffId: string | null; reviewedAt: string | null; reviewNote: string | null;
  offProductId: string | null; submittedAt: string | null; failureReason: string | null;
  createdAt: string; updatedAt: string;
}
```

`FoodEntryRecord` (diary) gained optional `foodId`, `foodDomain`,
`servingLabel`, `servingGrams`, `quantity` — all `null` for hand-typed
entries.

Stored in three `Database` collections: `customFoods`, `commonFoods`,
`brandedFoods`, plus `foodModerationRequests` and `foodSubmissions`. CRUD
lives in `lib/db.ts`: `findFoodById`, `findFoodByIdAnyDomain`,
`findCustomFoodsByUserId`, `findFoodByBarcode(domain, barcode, ownerUserId?)`,
`findAllFoods(domain)`, `saveFood`, `deleteFood`, plus matching CRUD for
moderation requests (`findAllFoodModerationRequests`, etc.) and submissions
(`findFoodSubmissionById`, `findFoodSubmissionsByUserId`,
`findFoodSubmissionByCustomFoodId`, `findAllFoodSubmissions`,
`saveFoodSubmission`, `createFoodSubmission`).

## Core library (`lib/food-catalog.ts`)

- `isBarcodeShaped(value)` — digits only, length 8/12/13/14.
- `isValidGtinChecksum(code)` — GS1 mod-10 check digit.
- `stringSimilarity(a, b)` — Levenshtein-based, normalized 0–1.
- `scoreFoodMatch(query, food)` — shared ranking scorer used identically for
  every section: exact barcode = 1000, exact name = 500, name prefix = 300,
  substring = 200, fuzzy similarity ≥ 0.6 → scaled to max 150, else excluded.
- `getFoodHistory(userEntries, resolveFood, query, limit)` — derived history,
  most-recent-first, only entries with a resolvable `foodId`/`foodDomain`.
- `searchFoodCatalog({ query, userEntries, customFoods, commonFoods, brandedFoods, resolveFood, limit })`
  → `{ history, custom, common, branded }`.
- `gramsForServing(food, servingLabel, quantity)`,
  `nutritionForGrams(nutrition100g, grams)` — the serving-math pair, mirrored
  on mobile.
- `normalizeOpenFoodFactsProduct(product, barcode, id, now)` — OFF payload →
  `FoodRecord`.
- `isBrandedRecordStale(food, now)` — true if `fetchedAt` is null or >30 days
  old (`BRANDED_CACHE_STALE_DAYS`).
- `parseCustomFoodInput(body)` — validates a custom-food create/update body.

## Search ranking (requirement #1 vs #7)

Requirement #1 fixes the **section order**: History → Custom → Common →
Branded, always rendered as four groups. Requirement #7's priority chain
(barcode > custom > history/recency > exact text > common > branded)
determines **ranking within each section** — an exact barcode hit floats to
the top of whichever section contains it, rather than getting its own
section, since the dedicated barcode endpoint (`GET /barcode`) is the primary
path for a literal scan.

## API contract

All routes are under `/api/mobile/nutrition/food/`, member-authenticated via
`verifyRequestSession()` (Bearer or cookie) unless noted.

| Route | Method | Purpose |
|---|---|---|
| `search?q=` | GET | `searchFoodCatalog()` → `{ history, custom, common, branded }` |
| `barcode?code=` | GET | Barcode lookup (see below) |
| `custom` | GET | List the member's own active (non-archived) custom foods |
| `custom/create` | POST | Create a custom food (`parseCustomFoodInput`) |
| `custom/update` | POST | Update a custom food; `{ archived: boolean }` also archives/restores |
| `custom/delete` | POST | Hard delete, ownership-checked |
| `label-scan` | POST | Label-scan contract (see below) |
| `report-missing` | POST | Create a `FoodModerationRequest` |
| `submission/create` | POST | Submit a custom food for public review (see below) |
| `submission/mine` | GET | List the member's own submissions |

Staff routes under `/api/mobile/staff/nutrition/`, gated by
`can(role, "foodCatalog.manage")` (admin tier — the shared catalog affects
every member, not one coach's own clients):

| Route | Method | Purpose |
|---|---|---|
| `moderation` | GET | List moderation requests |
| `moderation/resolve` | POST | `{ id, status: "resolved" \| "dismissed", resolvedFoodId? }` |
| `submissions` | GET | List all food submissions |
| `submissions/review` | POST | `{ id, decision: "approved" \| "rejected", note? }` (see below) |

### Barcode lookup (`GET /barcode?code=`)

Four-step order, per requirement #2:

1. Member's own custom foods, by barcode.
2. Local branded-food cache (`findFoodByBarcode("branded", code)`).
3. Live Open Food Facts lookup — on success, normalizes and caches the result
   into `brandedFoods` with `fetchedAt` set.
4. Not found anywhere → `{ found: false, action: "open_label_scan" }`, the
   trigger the mobile app uses to open the label-scan flow automatically.

### Label scan (`POST /label-scan`)

Accepts `{ imageBase64: <data URL> }`, validated by
`isValidImageDataUrl()` (`lib/image-upload.ts`) with a 3MB cap
(`MAX_LABEL_IMAGE_LENGTH`). Calls `ocrProvider.extract()`. In the current,
unconfigured state this always returns:

```json
{ "success": false, "code": "ocr_not_configured", "message": "..." }
```
with HTTP 501. `lib/ocr-provider.ts` also exports a standalone
`parseNutritionLabelText(rawText)` — a heuristic regex extractor for
calories/protein/carbs/fat/fiber/sugar/saturated-fat/sodium/serving-size —
ready for a real provider's `extract()` to call once one is wired in.

### Custom foods

`custom/create` and `custom/update` both run the body through
`parseCustomFoodInput()`, which validates name, optional barcode shape,
`nutrition100g`, and `servings`. Saving a barcode on a custom food means
future barcode scans resolve to it first (step 1 of the barcode lookup, ahead
of the branded cache and live OFF) — this is what requirement #4 ("future
scans of that barcode should resolve to the user's custom food first") maps
to structurally.

### Food submission workflow

Custom foods are **private by default**. A member can opt in to sharing one
publicly via Open Food Facts, but only once it clears eligibility:

```ts
getFoodSubmissionEligibility(food) → { eligibility: "private_only" | "eligible_for_submission", missingFields: string[] }
```
(`lib/food-submission.ts`, ported to mobile in `src/lib/queries/food-catalog.ts`
as the same pure function so the UI never claims a food is eligible when the
backend would reject it.) A food is only eligible when it's a **custom**
food (common/branded are already public) with a **brand name** and
**barcode** set — name, serving size, and calories/protein/carbs/fat are
already required to create a custom food at all, so those can't be missing.

`POST submission/create` — body `{ customFoodId, consent: true,
frontPhotoUrl?, labelPhotoUrl? }` (photos are optional inline data URLs,
capped at 3MB, validated the same way as bug-report screenshots via
`isValidImageDataUrl()`). Rejects if the food isn't eligible, if consent
isn't explicitly `true`, or if a submission for that food is already
in flight (`pending_review` / `approved` / `submitted_to_open_food_facts`) —
a `rejected` or `failed` prior attempt can be resubmitted. Creates a
`FoodSubmissionRecord` at `status: "pending_review"`.

Status lifecycle:

```
pending_review → approved → submitted_to_open_food_facts   (live write succeeds, config-gated)
               ↘ approved → failed                          (live write attempted, fails)
               ↘ approved                                   (live write disabled — terminal in this deployment)
               ↘ rejected                                    (staff declines)
```

`POST staff/nutrition/submissions/review` (`{ id, decision, note? }`) is the
only place a submission moves out of `pending_review`. Rejecting just records
the decision. Approving calls `isOffLiveWriteEnabled()` first — false in
this deployment, so the record stays `approved`; a future deployment with
real credentials would additionally attempt `offSubmissionProvider.submit()`
and move to `submitted_to_open_food_facts` or `failed` based on the result.
There is **no cron job draining `approved` submissions** — that's a
deliberate TODO boundary, not an oversight; wiring one up only makes sense
once there's a real provider for it to call.

### Open Food Facts write-prep

`lib/open-food-facts-client.ts` also exports the write side, mirroring the
`lib/ocr-provider.ts` pattern exactly — a real interface, a default
implementation that honestly reports itself unconfigured, and a config flag
so a future deployment can flip live writes on without touching any call
site:

```ts
interface OffSubmissionProvider {
  configured: boolean;
  submit(payload: OffWriteSubmission): Promise<{ ok: true; offProductId: string } | { ok: false; reason: string }>;
}
export const offSubmissionProvider: OffSubmissionProvider; // configured: false
export function isOffLiveWriteEnabled(): boolean;          // requires OFF_LIVE_WRITE_ENABLED=true AND a configured provider
```

`lib/food-submission.ts`'s `mapFoodToOffSubmissionPayload(food, photos?)` is
the pure mapping from our normalized `FoodRecord` to that write shape —
network-free, so it's testable independent of whether a provider exists.
To go live: implement a real `OffSubmissionProvider` (OFF's producer API
needs org credentials), swap the `offSubmissionProvider` export, and set
`OFF_LIVE_WRITE_ENABLED=true`. No route or mobile screen needs to change.

## Ingestion jobs

- **`scripts/seed-common-foods.mjs`** — one-off seed script, same
  dry-run/`--confirm`/timestamped-backup pattern as
  `scripts/seed-exercise-library.mjs`. Seeds 46 reference-nutrition common
  foods (proteins, carbs, fruit, veg, dairy/fats, legumes), idempotent by
  name. Run via `npm run seed:common-foods -- --confirm`.
- **`refreshBrandedFoodCacheJob`** (`lib/jobs/refresh-branded-food-cache.ts`)
  — registered in `lib/jobs/registry.ts`'s `ALL_JOBS`. Re-fetches
  `isBrandedRecordStale()` records from OFF, capped at 25 per run
  (`MAX_REFRESHED_PER_RUN`) to avoid hammering the OFF API.

## Admin moderation structure

Two independent staff queues, both gated by `foodCatalog.manage` (admin
tier) and both currently web-only — no staff *mobile* screen exists for
either, consistent with this app's convention that deep admin tooling (see
Finances, Reports) lives on the web staff app, not native mobile.

**Missing-food reports** — a member hits a search/barcode dead end and taps
"let us know this food is missing" → `FoodModerationRequest` created at
`status: "open"`. Staff resolve it by pointing at a `FoodRecord` they've
since added (`resolvedFoodId` + `resolvedByStaffId` set, `status:
"resolved"`), or dismiss it (`status: "dismissed"`).

**Food submissions** — independent of moderation; a member opts in to
publish their own custom food (see "Food submission workflow" above). Staff
approve or reject each `pending_review` submission via
`staff/nutrition/submissions/review`.

## Mobile integration (`sc-coaching-mobile`)

- **`src/lib/queries/food-catalog.ts`** — mirrors `FoodRecord` and the two
  gram-math functions exactly, plus `getFoodSubmissionEligibility()` mirrored
  from `lib/food-submission.ts`; exposes `useFoodSearch`, `lookupBarcode`,
  `useMyCustomFoods`, `useCreateCustomFood`, `useUpdateCustomFood`,
  `useDeleteCustomFood`, `useLabelScan`, `useReportMissingFood`,
  `useMySubmissions`, `useCreateSubmission`.
- **`src/lib/draft-photo-cache.ts`** — a tiny in-memory (not persisted)
  map from a just-created custom food's id to a label photo captured during
  label-scan, so `submit-food.tsx` can offer that same photo again instead of
  asking the member to capture it twice. Session-only by design.
- **`src/app/log-food.tsx`** — debounced (300ms) search box above the manual
  entry fields, rendering the four grouped sections with an inline loading
  spinner while searching. Tapping a result opens a serving card: a
  serving-label chip row plus a `Stepper` (0.5–20, step 0.5 — a 0.25 step was
  tried first but hits a rounding artifact in the shared Stepper's
  `toFixed(1)`, e.g. `1.25` displays as `1.3`) for quantity,
  showing the resulting total grams; changing either live-recomputes
  calories/macros via `nutritionForGrams(gramsForServing(...))` and fills the
  (still-editable) manual fields below, headed "REVIEW BEFORE LOGGING" (vs.
  "OR LOG MANUALLY" when nothing's selected, so the two modes read as
  distinct sections). A food that arrived via barcode-scan or a freshly
  created custom food shows a "Found it — review the serving below"
  confirmation. Logging shows a brief full-screen "Logged to {meal}"
  confirmation before returning to the diary. A no-results search offers
  "let us know this food is missing" inline. Manual entry remains available
  as a fallback throughout.
- **`src/app/barcode-scan.tsx`** — `expo-camera`'s `CameraView` with
  `onBarcodeScanned`; on a scan, calls `lookupBarcode()` and either routes
  back to `log-food` with the found food, or forwards to `label-scan` with
  the barcode carried over. The permission-denied state also offers "enter
  this food manually instead" rather than dead-ending.
- **`src/app/label-scan.tsx`** — captures a photo, downsamples it via
  `expo-image-manipulator` (1000px wide, JPEG q0.5) to stay under the label
  route's size cap, then shows a "Photo captured" confirmation stage while
  `useLabelScan()` runs. Since OCR is unconfigured, this almost always falls
  back to `custom-food` — framed as the honest, intentional MVP path (not an
  error) via `prefillSource: "label_scan_fallback"` copy, distinct from the
  (currently unreachable) `"label_scan_ocr"` copy for when a real OCR
  provider extracts fields. Either way the captured photo itself is carried
  forward as `capturedLabelPhoto`, so it isn't wasted even without OCR.
- **`src/app/custom-food.tsx`** — create/edit form. Collects nutrition **per
  serving** (what's printed on a label) rather than per 100g, and derives the
  canonical per-100g figures on submit — editing an existing food reverses
  this using the food's own `defaultServing` so the form round-trips exactly.
  Shows a banner keyed to `prefillSource` when arriving from label-scan, and
  a "label photo attached" chip when a `capturedLabelPhoto` param is present
  (cached via `draft-photo-cache.ts` on save for reuse in `submit-food.tsx`).
  An editing food shows a "Share this food publicly" link into `submit-food.tsx`.
- **`src/app/submit-food.tsx`** — the submission draft/review screen. Shows
  an eligibility checklist (with an "edit this food" link back if fields are
  missing), an explicit consent checkbox, optional front/label photo capture
  (reusing the same `expo-camera` capture pattern as label-scan, prefilling
  the label slot from the draft-photo cache when available), and the current
  submission status if one already exists (in review / approved / rejected /
  published / failed) with resubmission allowed once terminal.
- **`src/app/my-foods.tsx`** — list of the member's custom foods with a
  submission-status badge per row, linking into `custom-food.tsx` for
  edit/delete and a cloud-upload icon into `submit-food.tsx`.
- **`src/components/nutrition/CameraPermissionGate.tsx`** — shared across
  `barcode-scan.tsx` / `label-scan.tsx` / `submit-food.tsx`: `CameraPermissionDenied`
  distinguishes "not asked yet / can re-prompt" from "permanently denied"
  (`canAskAgain: false` — re-prompting silently no-ops on iOS once the user
  has said no with "don't ask again"; the only way back is Settings, so that
  state shows an "Open Settings" button via `Linking.openSettings()` instead
  of a dead "Allow camera access" button). `CameraUnavailable` handles the
  camera preview itself failing to start (`CameraView`'s `onMountError` —
  hardware in use elsewhere, a device/emulator with no camera), offering a
  manual-entry fallback rather than a blank/frozen preview.
- **`src/lib/analytics.ts`** — see "Analytics / observability" below.
- **`src/lib/submission-status.ts`** — single source of truth for submission
  status label/color/detail copy, shared by `my-foods.tsx`'s badge and
  `submit-food.tsx`'s status card (previously duplicated across both with
  drift risk).
- Camera access requires the `expo-camera` config plugin (`app.json`) and the
  `expo-camera` / `expo-image-manipulator` packages, added alongside this
  feature.

## Analytics / observability

No analytics vendor (PostHog/Amplitude/Segment/etc.) is wired up anywhere in
either app — `src/lib/analytics.ts` establishes the pattern rather than
following an existing one, deliberately mirroring the same "real interface,
honest unconfigured default, single swap point" shape already used for
`lib/ocr-provider.ts` and the OFF write provider: `trackEvent(event,
properties?)` calls through to a pluggable `analyticsProvider`, whose default
implementation only `console.log`s in `__DEV__` and no-ops in production.
Swapping in a real vendor means implementing `AnalyticsProvider` and
replacing the `analyticsProvider` export — every call site stays the same.
`trackEvent` never throws, so instrumentation can't break the flow it's
observing.

Events wired: `food_search_started`, `food_search_result_selected`,
`barcode_scan_started`, `barcode_scan_found`, `barcode_scan_not_found`,
`label_scan_started`, `label_scan_manual_fallback`, `custom_food_created`,
`food_submission_started`, `food_submission_eligible`, `food_submission_sent`,
`food_submission_rejected` (fired client-side the first time the member sees
their own submission come back as `rejected`) — plus a few additional
error/diagnostic events not in the original spec but consistent with it:
`barcode_scan_error`, `barcode_scan_camera_unavailable`,
`label_scan_camera_unavailable`, `food_submission_camera_unavailable`.

Backend-side, `console.warn`/`console.error` lines were added at the points
most useful for debugging a live deployment without building a logging
pipeline: an OFF barcode lookup that fails for a reason other than an honest
"not found" (`app/api/mobile/nutrition/food/barcode/route.ts`), an OCR
extraction failure once a real provider exists (`.../label-scan/route.ts` —
currently unreachable since `ocrProvider.configured` is always false), an OFF
live-write failure or misconfigured `OFF_LIVE_WRITE_ENABLED` flag
(`.../staff/nutrition/submissions/review/route.ts` and
`lib/open-food-facts-client.ts`, the latter warns once per process rather
than on every request).

## Staff review UI

`/staff/nutrition-submissions` (gated by `foodCatalog.manage`, same as the
moderation queue) is the first actual UI for the submission workflow — until
this pass, staff could only act on it via raw API calls. Mirrors the
bug-reports staff page pattern exactly: a server page
(`app/(staff)/staff/nutrition-submissions/page.tsx`) fetches
`findAllFoodSubmissions()` joined with each submission's `FoodRecord` and
submitter info, and a client view (`NutritionSubmissionsView.tsx`) filters by
pending/all/decided, shows per-100g-scaled nutrition, barcode, consent
timestamp, and both photos as clickable thumbnails, and posts to the existing
`submission/review` route with an optional note — surfaced back to the
member on `submit-food.tsx` when a submission is `rejected` or `failed`.

## Real-device verification checklist

Everything above has been verified in the Expo **web** preview — search
grouping, serving math, diary logging, custom-food round trips, the
submission workflow's UI logic (including the eligibility/consent/photo
states), and the staff review page. Camera-dependent behavior (actual
barcode decoding, actual photo capture, actual permission prompts, actual
camera-mount failures) cannot be exercised in a web browser and needs a real
device (TestFlight / Play internal testing) pass before shipping. Checklist:

- [ ] **Barcode scan — success path** — scan a real product barcode;
      confirms the food, serving picker opens, calories match a known label,
      and `barcode_scan_found` logs in dev.
- [ ] **Barcode scan — miss path** — scan a barcode with no OFF match (or a
      hand-written test barcode); confirms it forwards to label-scan
      automatically with the barcode carried through, and
      `barcode_scan_not_found` logs.
- [ ] **Permission denied path** — deny camera access on first prompt on
      each of barcode-scan, label-scan, and submit-food's photo capture;
      confirms `CameraPermissionDenied` renders (not a crash) and "enter this
      food manually instead" reaches `custom-food.tsx` with context intact.
      Then deny **permanently** ("don't ask again" on Android / repeated
      denial on iOS) and confirm the button changes to "Open Settings" and
      actually opens the OS settings screen for the app.
- [ ] **Label-scan capture path** — capture a nutrition label; confirms the
      image compresses without hanging or crashing on both iOS and Android,
      the "Photo captured" confirmation stage renders, and
      `label_scan_manual_fallback` logs (expected, since no OCR provider is
      configured).
- [ ] **Submission with photos path** — from `submit-food.tsx` on an
      eligible food, capture a front photo and a label photo independently;
      confirms both slots fill correctly without overwriting each other,
      submission succeeds, and `food_submission_sent` logs with
      `hasFrontPhoto`/`hasLabelPhoto` both true. Then check the photos render
      as clickable thumbnails on `/staff/nutrition-submissions`.
- [ ] **Cancellation / back-out path** — back out mid-capture on each camera
      screen (hardware back on Android, swipe/gesture on iOS) and via the
      in-app back button; confirms no stuck "capturing" state, no orphaned
      camera session, and the previous screen's state (search query, meal
      selection, in-progress form fields) is still intact on return.

Known device-vs-web-preview risks to watch for (not verifiable from this
environment):

- `expo-camera`'s `CameraView` behaves differently across iOS/Android for
  autofocus and barcode-scan responsiveness — the web preview uses a stub and
  proves nothing about scan reliability.
- The `expo-camera` config plugin (`app.json`) requires a native rebuild
  (`expo prebuild` / a new development build or EAS build) to take effect —
  simply reloading Metro is not enough once the plugin config changes.
- `expo-image-manipulator`'s `manipulateAsync` is deprecated upstream in
  favor of a context-based API; it still works but should be revisited if
  the SDK is upgraded past what's pinned in `package.json`.
- Large captured photos (front + label, up to ~3MB each as data URLs) are
  stored inline in `data/db.json` once submitted — fine at trial scale, but
  worth watching if submission volume grows before a real object-storage
  migration.
- `onMountError` is real device territory only — there's no reliable way to
  simulate a camera-hardware failure in the web preview, so
  `CameraUnavailable`'s rendering has only been verified by code review, not
  by actually triggering it.

### Production build blockers (app-wide, not food-catalog-specific)

Full build-readiness scaffolding, the identifier/account decision checklist,
and the internal-testing runbook now live in
`sc-coaching-mobile/docs/build-readiness.md` (a mobile-repo concern, kept
there rather than duplicated here). Summary: `eas.json` and the camera
plugin's mic-permission cleanup are done; `ios.bundleIdentifier` and
`android.package` are still deliberately unset — those, plus the Apple/Google
account setup and `eas init`, are decisions/actions only the app owner can
make (a wrong bundle identifier is hard to undo once a store record exists
under it, so a guessed placeholder would be riskier than no value at all).
