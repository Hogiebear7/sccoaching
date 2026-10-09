// Pure logic for the first-login dashboard walkthrough (components/dashboard/DashboardTour.tsx), kept free of React and the DOM so it
// can be tested directly.
//
// Persistence is NOT here. Whether a member has seen the tour is one boolean on their own profile, ProfileRecord.dashboardTourCompleted,
// written by POST /api/profile/tour. It is per account (so a shared device does not skip a new member's first run, and a returning member
// is not shown it again on another device), survives refresh, logout and login, and is deliberately unrelated to tenant, payment or
// entitlement state. The tour collects no personal data and no analytics event.

export interface TourStep {
  /** The data-tour value of the element to spotlight, or null for a centred intro or outro card. */
  target: string | null;
  title: string;
  body: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    target: null,
    title: "Welcome to your dashboard",
    body: "A quick 30-second look at where everything lives before you get started.",
  },
  {
    target: "next-session",
    title: "Your next session",
    body: "Whatever you've got booked shows here first. Nothing on the books yet? You can book straight from this card.",
  },
  {
    target: "readiness",
    title: "Readiness",
    body: "Log a daily recovery check-in and this fills in with a readiness score, your 7-day training load, sleep, and session guidance.",
  },
  {
    target: "nutrition",
    title: "Nutrition",
    body: "Log meals and hydration, and get an AI coach that already knows your goals, dietary needs, and training load.",
  },
  {
    target: "club",
    title: "Membership & your coach",
    body: "Check your plan status and message your coach directly — both live right here.",
  },
  {
    target: "quick-actions",
    title: "You're set",
    body: "Everything else — workouts, profile, settings — is one tap away from here or the nav. Have a good session.",
  },
];

export function isFirstStep(index: number): boolean {
  return index <= 0;
}

export function isLastStep(index: number, count: number = TOUR_STEPS.length): boolean {
  return index >= count - 1;
}

/** Next never runs past the last step. */
export function nextStepIndex(index: number, count: number = TOUR_STEPS.length): number {
  return Math.min(Math.max(index, 0) + 1, count - 1);
}

/** Back never runs before the first step. */
export function prevStepIndex(index: number): number {
  return Math.max(index - 1, 0);
}

/** The primary button reads "Finish" on the last step, "Next" otherwise. */
export function primaryActionLabel(index: number, count: number = TOUR_STEPS.length): "Next" | "Finish" {
  return isLastStep(index, count) ? "Finish" : "Next";
}

/** Escape skips the tour (the same as the Skip button, so it is recorded as seen). Every other key is left alone. */
export function tourKeyAction(key: string): "skip" | "none" {
  return key === "Escape" || key === "Esc" ? "skip" : "none";
}

/**
 * Focus trap for the dialog: which of `count` focusable controls should receive focus when Tab (or Shift+Tab) is pressed from `current`.
 * `current` is -1 when focus is outside the dialog's controls. Wraps in both directions.
 */
export function nextFocusIndex(count: number, current: number, shiftKey: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return shiftKey ? count - 1 : 0;
  return shiftKey ? (current - 1 + count) % count : (current + 1) % count;
}

export interface TourRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type CardPlacement =
  | { mode: "center"; width: number }
  | { mode: "anchored"; width: number; left: number; top: number | undefined; bottom: number | undefined };

/**
 * Where the walkthrough card goes. With no spotlight (the intro and outro steps) it is CENTRED, and the component centres it with a
 * flex wrapper rather than a CSS transform. With a spotlight it is anchored under the highlighted box, or above it when there is no room
 * below, and kept 16px inside the viewport edges.
 */
export function cardPlacement(rect: TourRect | null, viewportW: number, viewportH: number, pad: number): CardPlacement {
  const width = Math.min(340, viewportW - 32);
  if (!rect) return { mode: "center", width };
  const spaceBelow = viewportH - (rect.top + rect.height);
  const placeBelow = spaceBelow > 200 || spaceBelow > rect.top;
  return {
    mode: "anchored",
    width,
    left: Math.max(16, Math.min(rect.left, viewportW - width - 16)),
    top: placeBelow ? Math.min(rect.top + rect.height + pad * 2, viewportH - 20) : undefined,
    bottom: !placeBelow ? viewportH - rect.top + pad * 2 : undefined,
  };
}
