# Privacy Policy Compliance Audit — S&C Performance Coaching

**Date:** August 2026
**Scope:** `gym-app` (Next.js web + backend) and `sc-coaching-mobile` (Expo/React Native), audited against the live policy at `https://sandccoaching.com/privacy`, ahead of Google Play submission.

**This document is not legal advice and does not certify GDPR/UK GDPR or Google Play compliance.** It is a factual, code-grounded audit intended to be reviewed by a qualified privacy lawyer or data-protection professional before the revised policy is published and before the app is submitted to Google Play. Every claim below is either (a) cited to a specific file/line in the codebase, or (b) explicitly marked as unconfirmed and requiring a fact-check with a vendor, the business owner, or legal counsel. Nothing here should be read as a guarantee.

---

## 1. Gap analysis — current live policy vs. actual product

The live policy (as of this audit) already covers account details, profile information, emergency contacts, training data, cycle/pregnancy tracking, photos, AI-assisted features, Stripe/Revolut payments, messages, push notifications, contact-form submissions, bug reports, a dedicated AI section, cookies, retention, rights, security, and contact details — this is the result of a prior revision earlier in this project. Auditing it against the codebase in more depth surfaced the following **new** gaps:

| # | Gap | Severity |
|---|---|---|
| 1 | **Supabase is not disclosed anywhere in the policy**, despite storing real personal data: website contact-form submissions (name/email/phone/message) and member-linked exercise favourites (keyed by internal user ID). | High |
| 2 | Policy doesn't explain **legal bases** (contract/consent/legitimate interest) or the **separate legal condition for special-category data** (GDPR Art 9) that cycle, pregnancy, and medical/dietary-note data require. | High |
| 3 | No **international transfers** section — Anthropic (US-based) receives data with no disclosed transfer safeguard. | High |
| 4 | Retention is described only as "while your account is active" — doesn't reflect the **actual, confirmed automatic deletion** that already exists for some categories (14-day recovery-log purge) or the **absence** of any automatic deletion for most others. | Medium |
| 5 | No **Children** section. | Medium |
| 6 | "Connections to the site are encrypted" and "access is limited" are broadly true but were **not verified against the code** — no HSTS header, no HTTPS-redirect middleware, and no confirmed encryption-at-rest exist at the application level (this may still be fine at the hosting layer, but the policy shouldn't imply application-level guarantees that aren't there). | Medium |
| 7 | Deletion/export section doesn't mention that **Google Play requires an externally-accessible deletion method that doesn't require the app to be installed** — the existing email-based process already satisfies this, but the policy doesn't say so, which matters for the Play Console's account-deletion requirement writeup. | Low (policy-wording only) |
| 8 | "We don't use analytics or advertising trackers" was previously verified for the **website only**; this audit separately verified the **mobile app's dependencies** and confirms the claim now genuinely extends to the app too (see §9 audit below) — the policy can now say this with more confidence, not less. | N/A (positive finding) |

The revised draft in §3 addresses items 1–7. None of this closes the implementation-level blockers in §9 — those require code changes or vendor/legal confirmation, not just policy wording.

---

## 2. Facts that must be confirmed (cannot be resolved from the codebase alone)

- **Legal entity identity.** Only a trading name ("S&C Performance Coaching"), a town-level location ("Navan, Co. Meath"), an email, and a phone number exist anywhere in either repo. No registered company name, company registration (CRO) number, VAT number, or full registered address was found. `C:\Users\conor\gym-app\lib\content.ts:6,29-32`.
- **Hosting region.** Hosted on Hostinger (confirmed — `lib\app-config.ts:1`, `.env.local.example:7-11`, `docs\launch-checklist.md:35`) — but the datacenter country/region is not stated anywhere in the repo.
- **Supabase project region and its Data Processing Agreement.** Supabase is used for exercise-library content, `exercise_favorites` (linked to a member's internal user ID), and `contact_inquiries` (name/email/phone/message from the public contact form) — `supabase\migrations\20260817000000_exercise_library.sql:22-130`, `app\api\contact\route.ts:66-71`. No migration file for `contact_inquiries` exists in the tracked migrations, so its schema/RLS policy can't be verified from the repo either.
- **Backup regime.** No scheduled/automated backup system was found for the production datastore. The only backups found are one-off local safety copies (`.bak-<timestamp>`) written by destructive admin CLI scripts immediately before they run — `scripts\delete-non-staff.mjs:83-96`. `docs\launch-day-runbook.md:12,61` lists "confirm scheduled backups exist" as an unchecked manual checklist item, not an implemented system.
- **Vendor Data Processing Agreements / retention & training-use terms.** Not reviewed as part of this audit for Stripe, Revolut, Resend, Anthropic, Hostinger, or Supabase. In particular, whether Anthropic retains or trains on data sent through the API, and what transfer safeguard applies, is unconfirmed — Anthropic's own published terms should be checked directly, and ideally a signed DPA obtained.
- **Revolut's live status.** `docs\launch-checklist.md:55-56` describes Revolut as "dormant fallback code," with Stripe as the active provider — confirm which provider(s) are actually configured with live keys in the production environment right now, since the code auto-selects whichever is configured.
- **Whether the privacy policy is linked from inside the mobile app** (e.g. Settings), not just at signup — needed for Play Console's "policy accessible from inside the app" requirement.
- **Whether members can delete individual nutrition-diary/custom-food entries themselves** via the app UI (relevant to how confidently the policy can describe self-service control over food data).
- **Minimum age policy.** The business needs to actually decide a minimum age for using the service — the app currently accepts any date of birth in the past, with no age threshold enforced anywhere (`app\api\auth\signup\route.ts:163-174`, `app\api\mobile\auth\signup\route.ts:123-127`).
- **Confirmed retention period for financial records** — likely governed by Irish tax/accounting-record law (commonly ~6 years), but this should come from the business's accountant, not be assumed here.

---

## 3. Revised privacy policy — draft

The full draft has been applied to `app/privacy/page.tsx` (staged locally, **not yet committed**) so it can be previewed at the local dev URL before publishing. It restructures the policy into the 18 sections requested, and is reproduced here for review outside the code:

> See `app/privacy/page.tsx` for the exact live-formatted version (styling, links, brand-name interpolation). The prose content is identical to what's described section-by-section throughout this document — reading `page.tsx` directly is more reliable than re-copying it here, since the code is the source of truth for what will actually render.

Key drafting choices, and why:

- **No invented facts.** Where the underlying fact isn't confirmed (legal entity details, backup retention, international-transfer safeguards, vendor training-on-data practices), the draft either omits the claim entirely or states plainly what the mechanism is without asserting a legal conclusion. It does not use bracketed placeholders — every sentence is complete, accurate prose.
- **Security section was toned down**, removing any implication of encryption-at-rest or backup protection that isn't confirmed, while keeping what is genuinely true (HTTPS in practice, password hashing, role-based access).
- **Legal bases section is explicitly framed as a mapping for lawyer confirmation**, not a final legal determination — it does not assert that current consent UX satisfies GDPR Article 9(2)(a) for special-category data, because it doesn't yet (see blocker #5 below).
- **Deletion & export section stays general** ("we remove your account and the personal data tied to it, other than anything we're legally required to keep") rather than itemizing every data category, because the codebase audit found that hard-delete currently does **not** cascade to food/nutrition-diary entries (§9, blocker #1) — the previous policy language didn't make this specific claim either, but the admin UI's internal copy does, incorrectly. The public policy's general wording is accurate as written; the underlying gap still needs fixing in code.
- **Supabase, international transfers, and a Children section are now present** where they weren't before.

---

## 4. GDPR / UK GDPR legal-basis and special-category-data matrix

*Draft mapping for lawyer confirmation — not a final legal determination.*

| Data category | Likely Art. 6 basis | Special category (Art. 9)? | Likely Art. 9 condition | Notes |
|---|---|---|---|---|
| Account (email, password) | 6(1)(b) contract | No | — | |
| Core profile (name, phone, DOB, gender, country) | 6(1)(b) contract | No | — | |
| Emergency contact (name + phone of a third party) | 6(1)(b)/6(1)(f) | No | — | The named contact is a separate data subject with their own rights — worth a lawyer's view on whether/how to notify them |
| Profile photo | 6(1)(a) consent | No | — | Optional |
| Primary/secondary coaching goal, sport played | 6(1)(b) contract | No | — | |
| Height, weight | 6(1)(b) contract | Possibly (body measurements can reveal health) | 9(2)(a) if treated as health data | Lawyer to confirm whether basic fitness-app anthropometrics are treated as special category in this context |
| Body-fat % | 6(1)(a)/(b) | More clearly health-adjacent | 9(2)(a) | |
| Dietary preference | 6(1)(a)/(b) | Borderline | 9(2)(a) if treated as health-related | |
| Allergies, intolerances, medical/dietary notes | 6(1)(a) consent | **Yes — explicitly medical** | 9(2)(a) explicit consent | Current sign-up UX gap — see blocker #5 |
| Training sessions, exercises, recovery check-ins (sleep, soreness, fatigue, RPE, readiness) | 6(1)(b) contract | Possibly, where content reveals a health condition (e.g. an injury note) | 9(2)(a) if so | |
| Cycle tracking | 6(1)(a) consent | **Yes** | 9(2)(a) explicit consent | Off by default; enabling = consent, disabling = withdrawal; see blocker #5 for the UX gap |
| Pregnancy tracking | 6(1)(a) consent | **Yes** | 9(2)(a) explicit consent | Same gap as cycle tracking |
| Coach notes | 6(1)(f) legitimate interest | Possibly, if content references health/injury | 9(2)(a)/9(2)(h) | Not visible to the member in-app; covered by their access-rights request regardless |
| Payments | 6(1)(b) contract, 6(1)(c) legal obligation (accounting) | No | — | |
| Coach messages | 6(1)(b) contract | Possibly, depending on content | Depends on content | |
| Push token / device info | 6(1)(a) consent | No | — | Notifications are opt-in |
| Contact-form submissions | 6(1)(b) pre-contract steps / 6(1)(f) | No | — | |
| Bug report + screenshots | 6(1)(f) legitimate interest | Possibly, if a screenshot happens to show health data on-screen | — | |
| Rate-limit IP (contact form only, transient) | 6(1)(f) legitimate interest (security) | No | — | |

---

## 5. AI-processing disclosure matrix

*All "confirm" cells are genuinely unconfirmed — no claim is made about them in the public policy either.*

| Feature | Data sent to Anthropic | Purpose | Provider retention | Trains on inputs? | Human review possible? | Processing region | Transfer safeguard |
|---|---|---|---|---|---|---|---|
| Food-photo recognition | Food photo (image) | Identify food items + estimate macros | Confirm w/ vendor | Confirm w/ vendor | Confirm w/ vendor | US (Anthropic is US-based) — confirm | Confirm |
| Nutrition-label / receipt OCR | Label or receipt photo | Extract text / line items | Confirm | Confirm | Confirm | Confirm | Confirm |
| Fitness-tracker screenshot import | Tracker screenshot | Extract workout/sleep stats | Confirm | Confirm | Confirm | Confirm | Confirm |
| Free-text food description | Typed description | Estimate nutrition | Confirm | Confirm | Confirm | Confirm | Confirm |
| AI Coach chat | Member message + training/recovery/goal data | Conversational coaching | Confirm | Confirm | Confirm | Confirm | Confirm |
| AI Nutrition Coach chat | Member message + nutrition/dietary data | Conversational nutrition guidance | Confirm | Confirm | Confirm | Confirm | Confirm |
| Automated post-workout review | Session summary (sets/reps/RPE, sleep, nutrition context) | Generate a written review | Confirm | Confirm | Confirm | Confirm | Confirm |
| Saved food correction ("recognize this next time") | **Not sent to AI at all** — applied deterministically after the AI response, stored only in the app's own database (`lib\food-identification-override.ts`) | Remember the member's preferred correction | N/A — we retain it, not Anthropic | N/A | N/A | N/A | N/A |

**Positive, confirmed finding:** food/label/receipt/tracker photos are held only in server memory for the duration of the Anthropic API call and are **not written to the database afterwards** — confirmed by reading `app\api\mobile\nutrition\food\label-scan\route.ts`, `app\api\mobile\nutrition\receipt-scan\route.ts`, and `app\api\mobile\tracker-import\scan\route.ts` directly; none of the three import any database save function, and each route's own comments state this explicitly.

---

## 6. Third-party / vendor disclosure matrix

| Vendor | Role | Data received | Acts as processor? | DPA/contract confirmed? |
|---|---|---|---|---|
| Stripe | Payment processing | Email (for checkout), purchase amount/reference | Yes | Not confirmed in this audit |
| Revolut | Payment processing (confirm current live status vs. Stripe) | Same as Stripe | Yes | Not confirmed |
| Resend | Transactional email | Email address, name, email content | Yes | Not confirmed |
| Anthropic | AI-assisted coaching, food/photo recognition | See §5 | Yes (intended) | Not confirmed — recommend obtaining a DPA |
| Hostinger | Web hosting | The entire web app, including the JSON datastore at rest | Yes | Not confirmed |
| **Supabase** *(newly disclosed)* | Database/storage | Exercise-library content; member exercise favourites (linked to internal user ID); website contact-form submissions (name/email/phone/message) | Yes | Not confirmed |
| Open Food Facts | Public food database | Barcode/name search queries only — no personal data sent | No (not a personal-data processor) | N/A |
| Expo push service | Push notification delivery | Device push token, notification title/body | Yes | Not confirmed |
| Standard web push (browser vendors) | Browser push delivery | Push subscription endpoint/keys | Yes | Not confirmed (governed by each browser vendor's own infrastructure) |

---

## 7. Retention and deletion matrix

| Category | Current retention | Deletion mechanism | Confirmed? |
|---|---|---|---|
| Recovery check-ins | 14 days | Automatic scheduled job | ✅ `lib\jobs\purge-old-recovery-logs.ts:8` |
| Password-reset tokens | Until expiry | Automatic scheduled job | ✅ `lib\jobs\purge-expired-reset-tokens.ts` |
| Bug reports + screenshots | Indefinite, capped at the 300 most recent reports | Rolling cap (oldest dropped) or manual staff deletion — **not time-based** | ✅ confirmed as-is; code comments flag the whole feature as "trial-only, delete before full launch" |
| Rate-limit IP (contact form only) | ≤10 minutes, in-memory | Sliding-window expiry or process restart | ✅ never persisted to disk |
| Account, profile, training, nutrition, messages, coach notes | While account is active | Manual: staff archive → staff hard-delete (`admin_manager` role only) | ✅ confirmed manual; ⚠️ **food/nutrition-diary entries are not included in the hard-delete cascade** — gap |
| Session tokens (login cookie / mobile Bearer token) | **No expiry set** | Logout clears the client-side copy only; the token itself remains valid indefinitely if replayed | ⚠️ confirmed gap, should be fixed |
| Payment/purchase records | Indefinite (`RevenueEventRecord` explicitly "append-only and never pruned") | None | ✅ confirmed; likely appropriate for accounting purposes but the exact required retention period should come from an accountant |
| Backups | Unknown | Unknown | ❌ unconfirmed — no backup regime found in code |
| Supabase tables (exercise favourites, contact enquiries) | Unknown | No purge logic found | ❌ unconfirmed |

---

## 8. Google Play Data Safety & account-deletion checklist

| Item | Status |
|---|---|
| Policy URL is public and reachable without login | ✅ confirmed live at `https://sandccoaching.com/privacy` |
| Policy names the correct app/company | ✅ consistently "S&C Performance Coaching" (legal entity name still unconfirmed — see §2) |
| Policy accessible from inside the app | ⚠️ confirm a persistent link exists somewhere in the mobile app (not just the signup checkboxes) |
| Data Safety form matches the app | ❌ **the existing draft at `sc-coaching-mobile\docs\play-store-submission.md` is materially wrong** — states "Photos shared with 3rd party? No," which is false (photos go to Anthropic); its vendor list is missing Anthropic, Supabase, Open Food Facts, Revolut, and Expo push entirely |
| Health data declared accurately | ❌ needs explicit sub-type rows for body-fat %, height, and dietary/allergy/medical notes, not just a generic "health info" bucket |
| Cycle and pregnancy data declared | ❌ pregnancy isn't mentioned in the Data Safety draft at all |
| Food photos and AI processing declared as shared with a third party | ❌ currently marked "No" — must be corrected to "Yes — Anthropic" |
| Third-party SDKs inventoried | ✅ confirmed — only Expo's own notification/device modules are active on mobile; no analytics, crash-reporting, or ad SDKs found anywhere in `package.json` or source |
| Data deletion actually works | ❌ **blocker** — hard-delete doesn't remove food/nutrition-diary entries (§7); the whole path is a manual, human-actioned process with no code enforcing turnaround time |
| External (non-in-app) deletion route exists | ✅ email (`info@sandccoaching.com`) satisfies Play's requirement for a deletion method that doesn't require the app to be installed |
| Sensitive data transmitted securely | ⚠️ HTTPS is used in practice but not enforced at the application layer (no HSTS, no redirect middleware) — confirm Hostinger enforces this at the edge |
| Privacy disclosures appear before relevant collection | ⚠️ Terms/Privacy acceptance happens before signup completes; cycle/pregnancy toggles show descriptive copy but no distinct consent confirmation before data entry |
| Optional health data is genuinely optional | ✅ cycle/pregnancy confirmed off-by-default and independently toggleable |
| Policy doesn't contradict vendor behavior | ✅ fixed in the revised draft (Supabase now disclosed) |

---

## 9. Unresolved blockers

Ranked roughly by severity/urgency:

1. **[BLOCKER] Hard-delete doesn't remove food/nutrition-diary entries.** `foodEntries` is missing from `MEMBER_OWNED_COLLECTIONS` in `lib\db.ts:1865-1870`. The staff deletion UI's own copy claims this removes "all their data," which is currently untrue. Needs a code fix.
2. **[BLOCKER] The Play Store Data Safety draft is inaccurate** and must be rewritten before submission — see §8.
3. **[FACT MISSING] No confirmed legal entity identity** — no registered company name, CRO number, VAT number, or full address anywhere in either repo. Needed for the policy's controller-identification section to be complete.
4. **[FACT MISSING] Supabase was an undisclosed processor** until this revision, storing real contact-form PII and member-linked data, with unconfirmed region and DPA.
5. **[GAP] No distinct, affirmative consent-capture step for special-category data** (cycle, pregnancy, medical/dietary notes) beyond the general Privacy Policy checkbox and nearby descriptive copy. A lawyer should confirm whether the current toggle-based UX satisfies GDPR Art. 9(2)(a), or whether a separate "I consent to share this health information" confirmation is needed the first time each feature is enabled.
6. **[SECURITY] Session tokens never expire and cannot be revoked server-side.** Both the web cookie and the mobile Bearer token are signed payloads containing only `{ userId }` — no expiry claim. Logout only clears the client-side copy; a captured token remains valid indefinitely, even surviving a password change. `lib\session.ts:1-61`.
7. **[FACT MISSING] Hosting and Supabase region unconfirmed** — needed to make the "International transfers" section more specific than it currently is.
8. **[FACT MISSING] No confirmed backup regime** for the production datastore.
9. **[FACT MISSING] Vendor DPAs not reviewed** for any of Stripe, Revolut, Resend, Anthropic, Hostinger, or Supabase.
10. **[DECISION NEEDED] No minimum-age policy exists**, and none is enforced in the signup flow.
11. **[MINOR] Bug-report screenshots accumulate indefinitely** (300-report rolling cap only) despite code comments describing the entire feature as "trial-only, delete before full launch." Either implement real retention or follow through on removing the feature.
12. **[VERIFY] Whether members can delete individual food-diary/custom-food entries themselves** in the app UI.
13. **[VERIFY] Whether the privacy policy is linked from inside the mobile app itself**, not just at signup.

---

## Status

**NOT READY — PLAY STORE DATA SAFETY OR DELETION BLOCKER**

The revised policy draft (§3, applied to `app/privacy/page.tsx`) closes the policy-wording gaps found in §1. It has **not** been committed or published. Blockers #1 and #2 above are concrete product/documentation defects that should be fixed before Play Store submission regardless of the policy text. Blockers #3, #4, #7, #8, #9, and #10 are facts only the business owner, hosting/vendor accounts, or a lawyer can supply — this audit cannot resolve them from the codebase. This document, the revised policy, and every matrix above must be reviewed by a qualified privacy lawyer or data-protection professional before publication and before Play Store submission.
