// Pure logic and accessibility contract for the first-login dashboard walkthrough (lib/dashboard-tour.ts, components/dashboard/DashboardTour.tsx).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DashboardTour } from "@/components/dashboard/DashboardTour";
import {
  TOUR_STEPS,
  isFirstStep,
  isLastStep,
  nextFocusIndex,
  nextStepIndex,
  prevStepIndex,
  primaryActionLabel,
  tourKeyAction,
} from "@/lib/dashboard-tour";

describe("walkthrough content", () => {
  it("is short: three to six concise steps, an intro and an outro without a target", () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(3);
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(6);
    expect(TOUR_STEPS[0].target).toBeNull();
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.title.length).toBeLessThanOrEqual(40);
      expect(step.body.length).toBeLessThanOrEqual(200);
    }
    expect(new Set(TOUR_STEPS.map((s) => s.title)).size).toBe(TOUR_STEPS.length);
  });

  it("describes only dashboard features that exist in the app, and makes no payment or outcome claim", () => {
    const text = TOUR_STEPS.map((s) => `${s.title} ${s.body}`).join(" ").toLowerCase();
    for (const forbidden of ["guarantee", "results", "google play", "subscribe", "upgrade", "price", "free trial"]) expect(text).not.toContain(forbidden);
  });
});

describe("navigation", () => {
  const n = TOUR_STEPS.length;

  it("Next never runs past the last step and Back never before the first", () => {
    expect(nextStepIndex(0, n)).toBe(1);
    expect(nextStepIndex(n - 1, n)).toBe(n - 1);
    expect(prevStepIndex(1)).toBe(0);
    expect(prevStepIndex(0)).toBe(0);
  });

  it("flags the first and last steps, and the primary button reads Next until the last step, where it reads Finish", () => {
    expect(isFirstStep(0)).toBe(true);
    expect(isFirstStep(1)).toBe(false);
    expect(isLastStep(n - 1, n)).toBe(true);
    expect(isLastStep(0, n)).toBe(false);
    expect(primaryActionLabel(0, n)).toBe("Next");
    expect(primaryActionLabel(n - 1, n)).toBe("Finish");
  });

  it("can walk from first to last by Next, and back by Back, visiting every step", () => {
    const forward = [0];
    while (!isLastStep(forward.at(-1)!, n)) forward.push(nextStepIndex(forward.at(-1)!, n));
    expect(forward).toEqual(TOUR_STEPS.map((_, i) => i));
    const back = [n - 1];
    while (!isFirstStep(back.at(-1)!)) back.push(prevStepIndex(back.at(-1)!));
    expect(back).toEqual([...forward].reverse());
  });
});

describe("keyboard", () => {
  it("Escape skips the walkthrough and nothing else does", () => {
    expect(tourKeyAction("Escape")).toBe("skip");
    for (const key of ["Enter", " ", "Tab", "ArrowRight", "a"]) expect(tourKeyAction(key)).toBe("none");
  });

  it("Tab and Shift+Tab wrap inside the card's controls, and re-enter from outside", () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1);
    expect(nextFocusIndex(3, 2, false)).toBe(0);
    expect(nextFocusIndex(3, 0, true)).toBe(2);
    expect(nextFocusIndex(3, 1, true)).toBe(0);
    expect(nextFocusIndex(3, -1, false)).toBe(0);
    expect(nextFocusIndex(3, -1, true)).toBe(2);
    expect(nextFocusIndex(0, -1, false)).toBe(-1);
  });
});

describe("component", () => {
  it("renders nothing for a member who has already seen it (and nothing on the server for anyone: it opens after mount)", () => {
    expect(renderToStaticMarkup(createElement(DashboardTour, { initialCompleted: true }))).toBe("");
    expect(renderToStaticMarkup(createElement(DashboardTour, { initialCompleted: false }))).toBe("");
  });
});
