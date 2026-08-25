# Finance Admin — UAT Checklist

**Purpose:** confirm the rebuilt Finances workspace is trustworthy and usable before it's treated as the business's source of truth for money in/out.

**Scope:** `/staff/finances` and the Tier 2 classification fields on `/staff/catalog`. Not in scope: mobile app, member-facing pages, checkout/payment flows.

**Before you start:**
- Sign in as a staff user with the `admin_manager` role (Finances is gated to that role only).
- This checklist creates and deletes a few test entries — safe to run against the live dev/staging data, but don't run it against production unless you intend the test entries to be real (delete them at the end either way, per each scenario).
- Have a calculator or your phone handy to spot-check the arithmetic in a couple of scenarios.

Estimated time: 30–40 minutes.

---

## 1. Viewing overview numbers

**Steps:**
1. Open `/staff/finances`. Don't touch anything yet — just look.
2. Read the top four cards (Money in, Money out, Net after fees, Cash position) and the Month/Quarter/Year to date cards.

**Expected outcome:**
- The four top cards and three period cards are the first thing you see, before any breakdown or table.
- Every number is in €, formatted consistently (e.g. `€1,234.56` or `€0.00` — not raw numbers, not mixed currencies).
- Nothing reads as blank or broken — a page with no data yet shows `€0.00`, not an error or empty white space.

**Pass / Fail:** ☐

Notes:

---

## 2. Adding income

**Steps:**
1. Click **+ Add income**.
2. Set: Source = Apple, Type = Tier 2 app subscription, Status = Cleared, Date = today, Gross amount = `9.99`, Fee taken = `3.00`, Reference = `UAT-INCOME-1`.
3. Save.

**Expected outcome:**
- The entry appears in the Transactions table with Gross `€9.99`, Fee `€3.00`, Net `€6.99`.
- "Money in (this month)" increases by €9.99, "Net after fees" reflects the €3.00 fee deducted.
- The entry shows up under "Revenue by source" (Apple) and "Revenue by product" (Tier 2 app subscription).

**Pass / Fail:** ☐

Notes:

---

## 3. Adding expense

**Steps:**
1. Click **+ Add expense**.
2. Set: Expense type = Rent, Status = Cleared, Date = today, Amount = `500`, Notes = `UAT test expense`.
3. Save.

**Expected outcome:**
- "Money out (this month)" increases by €500.00.
- "Net after fees" decreases by €500.00.
- The entry appears under "Expenses by type" as Rent, and counts toward "Business expenses (non-payroll)" (not Payroll).

**Pass / Fail:** ☐

Notes:

---

## 4. Adding fee

**Steps:**
1. Click **+ Add fee**.
2. Set: Fee type = Stripe fee, Status = Cleared, Date = today, Amount = `12.50`.
3. Save.

**Expected outcome:**
- "Total fees" increases by €12.50 and this fee appears under "Fees by type" as Stripe fee, separately from any income-entry inline fee.
- "Net after fees" decreases by this €12.50 (in addition to anything already deducted from the income entry's own fee in Scenario 2).

**Pass / Fail:** ☐

Notes:

---

## 5. Editing a ledger row

**Steps:**
1. In the Transactions table, find the Rent expense from Scenario 3 and click **Edit**.
2. Confirm the form opens pre-filled with the existing values (Rent, €500.00, your notes).
3. Change the amount to `550` and save.

**Expected outcome:**
- The same row updates in place — no second/duplicate row appears.
- "Money out" and "Net after fees" recalculate to reflect €550.00, not €500.00 or €1,050.00.

**Pass / Fail:** ☐

Notes:

---

## 6. Deleting a ledger row

**Steps:**
1. Click **Delete** on the fee entry from Scenario 4.
2. Confirm you're asked to confirm before it actually deletes (not an instant, no-warning delete).
3. Confirm the deletion.

**Expected outcome:**
- The row disappears from the table immediately.
- "Total fees" and "Net after fees" drop back down by exactly €12.50.

**Pass / Fail:** ☐

Notes:

---

## 7. Updating finance settings

**Steps:**
1. Scroll to **Settings** at the bottom of the page.
2. Set: Cash position balance = `10000`, as-of date = today's date minus a few days, Tax rate = `20`, Stripe fee = `1.5`% + `0.25` fixed.
3. Save.

**Expected outcome:**
- A confirmation that settings saved (no error banner).
- The "Cash position (now)" card at the top updates to a real number instead of "Not set."
- The "Estimated tax" and "Estimated Stripe fee" panels further down now show real figures instead of "Set a rate below to see an estimate."

**Pass / Fail:** ☐

Notes:

---

## 8. Checking forecast outputs

**Steps:**
1. Look at the **Forecast** section (End of month / End of quarter / End of year).
2. Read the small explanation line under each number.

**Expected outcome:**
- Each forecast card shows its own plain-English basis, e.g. "€X net over Y days so far → €Z/day × N days" — you shouldn't have to ask "where did this number come from?"
- The forecast figures move sensibly with the income/expense entries you added above (e.g. adding a large expense should pull the forecast down, not up).

**Pass / Fail:** ☐

Notes:

---

## 9. Checking cash-position explanation

**Steps:**
1. Re-read the "Cash position (now)" card from Scenario 7.
2. Look specifically for language about where this number comes from.

**Expected outcome:**
- The card explicitly says this is app-calculated and **not** synced to a real bank balance (wording along the lines of "App-calculated, not bank-synced").
- It states the opening balance and date you set it from, plus that ledger movements since then are added on top — so it's clear this is an estimate, not a live feed.

**Pass / Fail:** ☐

Notes:

---

## 10. Creating a Tier 2 app-only package classification

**Steps:**
1. Go to `/staff/catalog`.
2. Create a new package under any category: Name = `UAT Tier 2 Test`, Delivery = App-only, Billed via = Google Play Billing, Access type = Subscription.
3. Save, and look at the package row.

**Expected outcome:**
- The row shows a visible badge/label indicating it's App-only / Google Play Billing — distinct from your normal in-person/Stripe packages.
- No pricing/billing option is created automatically, and nothing about this action should trigger an actual checkout or charge anywhere — it's a classification only.
- Delete the test package afterward to leave the catalog clean.

**Pass / Fail:** ☐

Notes:

---

## 11. Confirming the page is understandable to a new staff member

**Steps:**
1. Without re-reading anything above, imagine you are a brand-new staff member who has never seen this page.
2. Scan the page top to bottom once.

**Expected outcome:**
- You can state, in one sentence each and without help, what "Money in," "Money out," "Net after fees," and "Cash position" mean.
- You can find where to add an expense without hunting.
- Nothing on the page requires a support call or a README to interpret correctly.

**Pass / Fail:** ☐

Notes:

---

## Known limitations (by design — not defects)

- **Apple/Google income is manual entry only.** There is no automated import from App Store/Play Store yet — every Tier 2 app-subscription payment must be entered by staff (as in Scenario 2). The data model supports automating this later without a rebuild, but that ingestion doesn't exist today.
- **Cash position is app-calculated, not bank-synced.** It is only as accurate as the opening balance you set and how consistently every real expense/fee gets logged in this ledger. It will never automatically match your actual bank balance if something happens outside this system (a bank fee, a manual withdrawal, etc.).
- **Membership-subscription refunds have a manual workaround.** Pass/top-up refunds are tracked automatically. A refund on a recurring Tier 1 membership charge is *not* auto-reflected here — staff should log a manual ledger entry (status = Refunded) if it needs to show up in Finances.
- **No member/package picker on manual ledger entries.** When you add income/expense/fee manually, you can't currently attach it to a specific member or catalog package — use the Notes/Reference field for that context. Automatic Stripe/Revolut income still shows the correct member/package.

---

## Sign-off

**Build / commit tested:** ________________________________
*(fill in the git commit hash or deployment build tag you actually tested against)*

**Tester name:** ________________________________

**Date:** ________________________________

**Overall pass/fail status:**
☐ Pass — all 11 scenarios passed as expected
☐ Pass with notes — passed, minor issues logged below
☐ Fail — one or more scenarios did not meet expected outcome (list below)

**Known limitations acknowledged:** ☐ Yes — reviewed and accepted as by-design (see section above)

**Issues found (if any):**




**Decision:**
☐ Accept — ready to treat as the business's finance source of truth
☐ Accept with conditions — usable now, conditions below must be addressed on a defined timeline
☐ Reject — not ready; blocking issues below must be fixed before re-test

**Conditions / blocking issues (if applicable):**




**Signature:** ________________________________
