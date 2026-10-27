// Test-only default, registered as a vitest setup file (vitest.config.ts).
//
// The daily AI cap (a third of a member's 30-day allowance in any 24 hours, lib/ai-allowance.ts) would stop the many tests that spend a month's
// allowance at one instant to check the 30-day, trial, pool and ceiling rules. Those tests are about the other limits, so the suite defaults the daily
// share to the whole allowance. The daily cap has its own tests, which set AI_DAILY_SHARE themselves.
process.env.AI_DAILY_SHARE ??= "1";
