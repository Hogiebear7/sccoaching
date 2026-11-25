# Trial pass (2026-11-25)

A one-off pass for people new to the gym (the owner's example: 3 classes for 50 euro) so they can try it without joining.

**Rules (lib/intro-pass.ts):** each member can buy it once (a refunded one does not use up the go), and only before any membership has been paid for. Once the member has, or ever had, a membership (a subscription that got past "not started", or a paid membership purchase), the option is hidden from their account and checkout refuses it (409).

**Set it up (staff, no code):** Staff > Catalog > the class category > New package: Type **Pass**, Session allowance **Fixed count**, number of sessions **3**, tick **Trial pass**. Then add one billing option: one-time, 50.00 EUR. Pick the class types it can book. Make it visible.

**Where it applies:** the website membership page and its checkout. The mobile app's membership screen is status only (it sells nothing), so it neither shows nor sells the trial pass.

**How it is enforced:** the rule runs in the catalogue page (hides the option) and again in `POST /api/membership/checkout` (refuses), so hiding is never the only protection. Staff can still assign a pass by hand.

Tests: `__tests__/api/intro-pass.test.ts`.
