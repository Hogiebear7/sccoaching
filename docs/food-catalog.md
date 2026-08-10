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
- **OFF submission is consent-gated and stops at "queued."** No code path
  actually writes to Open Food Facts — that needs OFF producer credentials
  this repo doesn't have. The state machine (`pending_consent` → `queued`) is
  real and resumable once credentials exist.

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

type OffSubmissionStatus = "pending_consent" | "queued" | "submitted" | "failed";
interface FoodOffSubmissionRecord {
  id: string; userId: string; customFoodId: string; status: OffSubmissionStatus;
  consentedAt: string | null; submittedAt: string | null; failureReason: string | null;
  createdAt: string; updatedAt: string;
}
```

`FoodEntryRecord` (diary) gained optional `foodId`, `foodDomain`,
`servingLabel`, `servingGrams`, `quantity` — all `null` for hand-typed
entries.

Stored in three `Database` collections: `customFoods`, `commonFoods`,
`brandedFoods`, plus `foodModerationRequests` and `foodOffSubmissions`. CRUD
lives in `lib/db.ts`: `findFoodById`, `findFoodByIdAnyDomain`,
`findCustomFoodsByUserId`, `findFoodByBarcode(domain, barcode, ownerUserId?)`,
`findAllFoods(domain)`, `saveFood`, `deleteFood`, plus matching CRUD for
moderation requests and OFF submissions.

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
| `off-submission/request` | POST | Create an OFF submission at `pending_consent` (requires the custom food to have a barcode) |
| `off-submission/consent` | POST | Flip `pending_consent` → `queued`, set `consentedAt` |

Staff routes under `/api/mobile/staff/nutrition/moderation/`, gated by
`can(role, "foodCatalog.manage")` (admin tier — the shared catalog affects
every member, not one coach's own clients):

| Route | Method | Purpose |
|---|---|---|
| `` (root) | GET | List moderation requests |
| `resolve` | POST | `{ id, status: "resolved" \| "dismissed", resolvedFoodId? }` |

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

A member hits "report missing food" (search/barcode dead end) →
`FoodModerationRequest` created at `status: "open"`. Staff with
`foodCatalog.manage` review the queue and either:

- resolve it by pointing at a `FoodRecord` they've since added
  (`resolvedFoodId` + `resolvedByStaffId` set, `status: "resolved"`), or
- dismiss it (`status: "dismissed"`).

Separately, a member can request their own custom food be submitted to Open
Food Facts (`off-submission/request` → `off-submission/consent`). This is
independent of moderation — it's member-initiated and requires explicit
consent before a (currently unbuilt) submission job would drain the
`queued` state.

## Mobile integration (`sc-coaching-mobile`)

- **`src/lib/queries/food-catalog.ts`** — mirrors `FoodRecord` and the two
  gram-math functions exactly; exposes `useFoodSearch`, `lookupBarcode`,
  `useMyCustomFoods`, `useCreateCustomFood`, `useUpdateCustomFood`,
  `useDeleteCustomFood`, `useLabelScan`, `useReportMissingFood`,
  `useRequestOffSubmission`, `useConsentOffSubmission`.
- **`src/app/log-food.tsx`** — debounced (300ms) search box above the manual
  entry fields, rendering the four grouped sections. Tapping a result shows a
  serving-label chip row + quantity input; changing either live-recomputes
  calories/macros via `nutritionForGrams(gramsForServing(...))` and fills the
  (still-editable) manual fields. Manual entry remains available as a
  fallback. A returning food (from barcode-scan or a newly-created custom
  food) arrives back via a `foodJson` route param and is applied the same way
  as a tapped search result.
- **`src/app/barcode-scan.tsx`** — `expo-camera`'s `CameraView` with
  `onBarcodeScanned`; on a scan, calls `lookupBarcode()` and either routes
  back to `log-food` with the found food, or forwards to `label-scan` with
  the barcode carried over.
- **`src/app/label-scan.tsx`** — captures a photo, downsamples it via
  `expo-image-manipulator` (1000px wide, JPEG q0.5) to stay under the label
  route's size cap, calls `useLabelScan()`. Since OCR is unconfigured, this
  currently always falls back to `custom-food` with just the barcode carried
  over (a real provider's extracted fields would prefill the same form).
- **`src/app/custom-food.tsx`** — create/edit form. Collects nutrition **per
  serving** (what's printed on a label) rather than per 100g, and derives the
  canonical per-100g figures on submit — editing an existing food reverses
  this using the food's own `defaultServing` so the form round-trips exactly.
- **`src/app/my-foods.tsx`** — list of the member's custom foods, linking
  into `custom-food.tsx` for edit/delete.
- Camera access requires the `expo-camera` config plugin (`app.json`) and the
  `expo-camera` / `expo-image-manipulator` packages, added alongside this
  feature.
