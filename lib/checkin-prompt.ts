// A nudge to do the daily check-in shortly before a booked class, if it has not been done yet. The coach's pre-class brief is much more useful
// when the member has checked in (readiness, sleep, soreness), so about an hour before, a member who is booked in and has no check-in for the
// class day gets one gentle prompt. Pure, so it can be tested without the datastore.

/** Send once the class is this close or closer. */
export const PROMPT_WITHIN_MINS = 60;
/** Not worth sending in the last stretch before the class: they are already on their way. */
export const NOT_TOO_LATE_MINS = 20;

export function checkinPromptDue(args: { nowMs: number; classMs: number; alreadyCheckedIn: boolean; alreadyAttended?: boolean }): boolean {
  if (args.alreadyCheckedIn || args.alreadyAttended) return false;
  const leadMins = (args.classMs - args.nowMs) / 60_000;
  return leadMins <= PROMPT_WITHIN_MINS && leadMins >= NOT_TOO_LATE_MINS;
}
