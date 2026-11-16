import { describe, expect, it } from "vitest";

import { checkinPromptDue, NOT_TOO_LATE_MINS, PROMPT_WITHIN_MINS } from "@/lib/checkin-prompt";

const MIN = 60_000;

describe("check-in prompt before class", () => {
  const classMs = 1_000_000_000_000;

  it("is due from an hour before the class until shortly before it", () => {
    expect(checkinPromptDue({ nowMs: classMs - PROMPT_WITHIN_MINS * MIN, classMs, alreadyCheckedIn: false })).toBe(true);
    expect(checkinPromptDue({ nowMs: classMs - 45 * MIN, classMs, alreadyCheckedIn: false })).toBe(true);
    expect(checkinPromptDue({ nowMs: classMs - NOT_TOO_LATE_MINS * MIN, classMs, alreadyCheckedIn: false })).toBe(true);
  });

  it("is not due too early or too late", () => {
    expect(checkinPromptDue({ nowMs: classMs - 61 * MIN, classMs, alreadyCheckedIn: false })).toBe(false);
    expect(checkinPromptDue({ nowMs: classMs - 19 * MIN, classMs, alreadyCheckedIn: false })).toBe(false);
    expect(checkinPromptDue({ nowMs: classMs + 5 * MIN, classMs, alreadyCheckedIn: false })).toBe(false);
  });

  it("is never due once the member has checked in or already attended", () => {
    expect(checkinPromptDue({ nowMs: classMs - 45 * MIN, classMs, alreadyCheckedIn: true })).toBe(false);
    expect(checkinPromptDue({ nowMs: classMs - 45 * MIN, classMs, alreadyCheckedIn: false, alreadyAttended: true })).toBe(false);
  });
});
