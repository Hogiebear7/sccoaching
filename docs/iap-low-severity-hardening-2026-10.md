# Play and billing low-severity hardening (2026-10)

Closes **LOW 2, LOW 3, LOW 4** and documents **LOW 5** and **LOW 6** from the post-merge audit.

## LOW 2: staff pause and resume on a Google Play row

`POST /api/staff/members/[userId]/pause` could write `paused` or `active` onto a row billed through Google Play. A Play row's status mirrors
Google's, and the member pauses, resumes and cancels inside Google Play. A staff write would contradict the store (for example `active` while
Play still has it paused, or `paused` while Play keeps billing) and could not be undone from this side.

**Now:** for `provider: "google_play"` rows, both `pause` and `resume` are refused with **HTTP 409** and the stable code
**`play_billing_active`**, whatever the row's status (active, past_due, paused, cancelled but paid through, or already ended). The row, purchase
token, provider and paid-through date are not touched, and nothing is sent to Google. Each refused attempt writes one `staff_write_rejected`
audit event with `code`, `action` and `source: "staff_pause_resume"` (never a token). An invalid action is still a 400. Stripe, Revolut and manual
(`none`) rows behave exactly as before.

This route is not converted to the runtime tenant helper in this change; it keeps its existing `sameGym` check and stays on the list of legacy
routes.

## LOW 3: duplicate audit rows for a refused Revolut event

A refused Revolut event is acknowledged with HTTP 200 but, unlike Stripe, had no event id to dedupe on, so every redelivery added another
`provider_conflict_rejected` row.

**Now:** the first refusal is recorded in the payment-event ledger under a stable key, `revolut_conflict:` plus the SHA-256 of
`<event>:<order id>`, and a redelivery of the same refused event writes no second audit row. Only the **hash** is stored: the ledger entry has no
entity id, no payload and no reference; the audit row keeps the existing hashed `referenceHash`. Only the audit is deduplicated. The response and
the untouched subscription row are identical on every delivery. A different refused event for the same order (for example `ORDER_CANCELLED` after
`ORDER_COMPLETED`) is audited separately, and accepted events are unaffected.

## LOW 4: no global network guard in tests

`__tests__/setup/network-guard.ts` is registered in `vitest.config.ts` (`setupFiles`) and applies to every test file. It makes `fetch`,
`http(s).request/get` and raw socket connects to any non-loopback host throw a `NetworkBlockedError` that names the host, so a missing mock fails
loudly everywhere instead of reaching a provider or failing only offline. Loopback stays open. A test that installs its own stub (`vi.stubGlobal`,
`vi.spyOn`, direct assignment) overrides the guard for that test only. The existing suite needed no changes. `__tests__/lib/network-guard.test.ts`
covers blocked fetch, http, https and sockets, loopback classification and the stub override. It is a test-only file: production code is untouched.

## LOW 5: `iapEvents` has no in-app reader and no retention limit (documented, follow-up)

`iapEvents` is the append-only audit log (`appendIapEvent` is the only writer). Today:

- **Reader:** there is **no staff or member route** that reads it. The only readers are `findIapEvents` (used by tests) and the operator script
  `scripts/iap-report.mjs`, which reads `data/db.json` directly. `lib/resource-scope.ts` records that no gym role may read it yet; any future
  reader must authorise through the owner's gym or the platform.
- **Retention:** there is **no limit and no pruning**. The log grows with every claim, notification, reconciliation run and refusal, and rows
  survive account deletion (owner decision 6 is open). Detail values are short primitives and tokens are stored only as hashes.

Nothing is deleted or capped here, because the log is the evidence trail for money-related refusals and manual recovery
(`provider_conflict_rejected`, `late_checkout_recovery`, `staff_write_rejected`). **Follow-up, not built:**

1. A read path: a platform-admin (and later per-gym, tenant-filtered) audit view with `userId`, `type` and date filters.
2. A retention policy decided by the owner (and counsel for personal-data questions): for example archive rows older than N months to cold
   storage rather than delete, keep refusal and recovery events longest, and anonymise `userId` on account deletion only if that is decided.
3. On the SQL backend: an indexed `(userId, at)` table with partitioning by month.

## LOW 6: mobile shows `other_provider_active` as a generic error (documented only)

The server answers a Google Play claim over a live Stripe or Revolut subscription with HTTP 409 and the stable code `other_provider_active`
(`docs/google-play-server-contract-2026-10.md` describes the contract). The mobile app does not map that code, so a member sees a
generic purchase error. **This change deliberately does not modify `sc-coaching-mobile`.** Recommended follow-up there: map `other_provider_active`
to a specific message (for example "You already have an active membership billed outside Google Play. It must end before you can subscribe here.")
and avoid retry prompts, since retrying cannot succeed until the other subscription ends. Copy is the owner's decision.

## Tests

`__tests__/api/play-low-severity-hardening.test.ts` (real routes, real service, real temporary datastore, fake Play adapter, throwaway Revolut
secret): pause refused, resume of a Play-paused row refused, cancelled-but-paid and expired rows refused, token / provider / paid-through /
ownership preserved, audit contents, non-Play rows unaffected, invalid action, Revolut single-audit across repeated deliveries, separate events
audited separately, hash-only storage, accepted events unaffected. `__tests__/lib/network-guard.test.ts` covers the guard.
