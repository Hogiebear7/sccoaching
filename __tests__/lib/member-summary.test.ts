// The member summary and class brief (lib/member-summary.ts): pure, from crafted inputs, with a fixed "today" so nothing depends on the clock.
import { describe, expect, it } from "vitest";

import { buildClassBrief, buildMemberSummary, checkInSummary, classSummary, daysAgoISO, nutritionSummary, trainingSummary, weightSummary, type SummaryInputs } from "@/lib/member-summary";

const TODAY = "2026-11-10";
const ago = (n: number) => daysAgoISO(TODAY, n);
const T = "2026-01-01T00:00:00.000Z";

const session = (daysAgo: number, over: Record<string, unknown> = {}, kg = 100) =>
  ({
    id: `s${daysAgo}-${Math.random()}`, userId: "u", date: ago(daysAgo), title: "Session", durationMins: 45, notes: null,
    exercises: [{ exerciseId: null, name: "Row", weight: String(kg), reps: 10, sets: 3 }], runs: [], createdAt: T, updatedAt: T, ...over,
  }) as never;

const log = (daysAgo: number, over: Record<string, unknown> = {}) =>
  ({
    id: `r${daysAgo}`, userId: "u", date: ago(daysAgo), sleepHours: 7, sleepQuality: 7, soreness: 3, fatigue: 2, trainingDurationMins: null, rpe: null, goal: null,
    notes: null, healthNote: null, readinessScore: 75, createdAt: T, updatedAt: T, ...over,
  }) as never;

const inputs = (over: Partial<SummaryInputs> = {}): SummaryInputs => ({
  todayISO: TODAY, fullName: "Mary Murphy", primaryGoal: "General Health", trainingDaysPerWeek: 3, goalWeightKg: null, goalTargetDate: null,
  sessions: [], bookings: [], recoveryLogs: [], foodByDate: {}, targetCalories: 2000, targetProteinG: 120, waterByDate: {}, weightLogs: [], ...over,
});

describe("training", () => {
  it("counts days in each window, finds the last session, and reads effort from RPE (hard 7.5 and up, easy below 5.5)", () => {
    const hard = trainingSummary([session(0, { sessionRpe: 9 }), session(2, { sessionRpe: 8 }), session(5), session(20)], TODAY, 3);
    expect(hard).toMatchObject({ daysTrainedLast3: 2, daysTrainedLast7: 3, daysTrainedLast30: 4, lastSessionDate: ago(0), daysSinceLastSession: 0, effortLast3Days: "hard" });
    expect(trainingSummary([session(1, { sessionRpe: 4 })], TODAY, 3).effortLast3Days).toBe("easy");
    expect(trainingSummary([session(1, { sessionRpe: 6.5 })], TODAY, 3).effortLast3Days).toBe("moderate");
    expect(trainingSummary([session(10)], TODAY, 3).effortLast3Days).toBe("none");
  });

  it("without RPE, judges effort against the member's own usual session volume", () => {
    const usual = [session(9), session(12), session(15), session(18)]; // 3000 kg each
    expect(trainingSummary([...usual, session(1, {}, 200)], TODAY, 3).effortLast3Days).toBe("hard"); // 6000
    expect(trainingSummary([...usual, session(1, {}, 50)], TODAY, 3).effortLast3Days).toBe("easy"); // 1500
    expect(trainingSummary([...usual, session(1, {}, 100)], TODAY, 3).effortLast3Days).toBe("moderate");
  });

  it("flags a load spike: this week's volume well above the average of the four weeks before", () => {
    const base = [session(9), session(16), session(23), session(30)]; // 3000 a week on average: 750 per week over 4 = 3000/4 per... (4 sessions / 4 weeks = 3000 per week)
    expect(trainingSummary([...base, session(1, {}, 200), session(2, {}, 200)], TODAY, 3).loadSpike).toBe(true); // 12000 vs 3000
    expect(trainingSummary([...base, session(1)], TODAY, 3).loadSpike).toBe(false);
    expect(trainingSummary([session(1)], TODAY, 3).loadSpike).toBe(false); // no history to compare against
  });
});

describe("classes", () => {
  it("counts attended and missed in the last 30 days and lists what is next", () => {
    const b = (days: number, over: Record<string, unknown> = {}) => ({ date: ago(days), startTime: "10:00", title: "Over 50s", attended: true, missed: false, upcoming: false, ...over });
    const s = classSummary(
      [b(2), b(5), b(9, { attended: false, missed: true }), b(12, { attended: false, missed: true }), b(40), b(-2, { attended: false, upcoming: true })],
      TODAY
    );
    expect(s).toMatchObject({ bookedLast30: 4, attendedLast30: 2, missedLast30: 2, attendedOfLast6: 2, missedOfLast6: 2, lastAttendedDate: ago(2) });
    expect(s.upcoming).toHaveLength(1);
  });
});

describe("check-ins", () => {
  it("averages the last 14 days, shows the trend, and carries a current health note (stale ones are dropped)", () => {
    const c = checkInSummary([log(0, { readinessScore: 90, healthNote: "Pulled my hamstring" }), log(2, { readinessScore: 80 }), log(4, { readinessScore: 60 }), log(6, { readinessScore: 50 })], TODAY);
    expect(c).toMatchObject({ checkInsLast14: 4, averageReadiness: 70, readinessTrend: "improving", daysSinceLatest: 0 });
    expect(c.healthNote).toMatchObject({ note: "Pulled my hamstring", ageDays: 0, mentionsIllnessOrInjury: true });
    expect(checkInSummary([log(9, { healthNote: "Old cold" })], TODAY).healthNote).toBeNull();
  });
});

describe("nutrition and water", () => {
  it("uses the last 3 COMPLETED days (today is not held against them) and compares with the targets", () => {
    const n = nutritionSummary({
      todayISO: TODAY, targetCalories: 2000, targetProteinG: 100,
      foodByDate: { [ago(0)]: { calories: 100, proteinG: 5 }, [ago(1)]: { calories: 1800, proteinG: 90 }, [ago(2)]: { calories: 2200, proteinG: 110 } },
      waterByDate: { [ago(1)]: 2400, [ago(3)]: 1600 },
    });
    expect(n).toMatchObject({ daysLoggedLast3: 2, caloriePercentOfTarget: 100, averageCalories: 2000, proteinPercentOfTarget: 100, averageWaterMl: 2000, waterDaysLoggedLast3: 2 });
  });
});

describe("weight", () => {
  it("shows the latest weight, the change over 30 and 90 days, and the distance to the goal", () => {
    const w = (days: number, kg: number) => ({ id: `w${days}`, userId: "u", date: ago(days), weightKg: kg, createdAt: T });
    const s = weightSummary([w(80, 90), w(35, 88), w(0, 85)], TODAY, 80, "2027-03-01");
    expect(s).toMatchObject({ latestKg: 85, changeLast30DaysKg: -3, changeLast90DaysKg: -5, kgToGoal: -5, weighInsLast90: 3 });
    expect(weightSummary([w(0, 85)], TODAY, null, null)).toMatchObject({ latestKg: 85, changeLast30DaysKg: null });
  });
});

describe("flags, state and the class brief", () => {
  it("an illness or injury note is a caution; an ordinary note is only a note; no data at all says so", () => {
    const sick = buildMemberSummary(inputs({ recoveryLogs: [log(0, { healthNote: "Off sick, fever" })], sessions: [session(1)] }));
    expect(sick.state).toBe("caution");
    expect(sick.flags[0]).toMatchObject({ code: "health_note", severity: "caution" });
    const calm = buildMemberSummary(inputs({ recoveryLogs: [log(0, { healthNote: "Busy week at work" })], sessions: [session(1)] }));
    expect(calm.flags[0]).toMatchObject({ code: "health_note", severity: "note" });
    expect(calm.state).toBe("good");
    expect(buildMemberSummary(inputs()).state).toBe("no_recent_data");
  });

  it("low readiness, a load spike, poor sleep, low food and water and missed classes each raise their own flag; two notes means take care", () => {
    const s = buildMemberSummary(
      inputs({
        sessions: [session(9), session(16), session(23), session(30), session(1, {}, 200), session(2, {}, 200)],
        recoveryLogs: [log(0, { readinessScore: 40, sleepHours: 5 })],
        foodByDate: { [ago(1)]: { calories: 1000, proteinG: 40 }, [ago(2)]: { calories: 1100, proteinG: 45 } },
        waterByDate: { [ago(1)]: 600 },
        bookings: [1, 3, 5, 7].map((d) => ({ date: ago(d), startTime: "10:00", title: "C", attended: false, missed: true, upcoming: false })),
      })
    );
    expect(s.flags.map((f) => f.code).sort()).toEqual(["load_spike", "low_hydration", "low_nutrition", "low_protein", "low_readiness", "low_sleep", "missed_classes"]);
    expect(s.state).toBe("caution");
    const two = buildMemberSummary(inputs({ sessions: [session(1)], recoveryLogs: [log(0, { sleepHours: 5 })], waterByDate: { [ago(1)]: 600 } }));
    expect(two.state).toBe("take_care");
  });

  it("the class brief is a few plain lines: how much and how hard they trained, today's check-in, food, water, classes, and the note", () => {
    const brief = buildClassBrief(
      inputs({
        sessions: [session(0, { sessionRpe: 8 }), session(2, { sessionRpe: 8 }), session(5)],
        recoveryLogs: [log(0, { readinessScore: 72, sleepHours: 6.5, soreness: 4, healthNote: "Tight calf" })],
        foodByDate: { [ago(1)]: { calories: 1700, proteinG: 100 } },
        waterByDate: { [ago(1)]: 1800 },
        bookings: [{ date: ago(2), startTime: "10:00", title: "C", attended: true, missed: false, upcoming: false }],
      })
    );
    expect(brief.lines).toEqual([
      "Trained 3 days in the last 7 (2 in the last 3, hard effort).",
      "Today's check-in: readiness 72/100, slept 6.5 h, soreness 4/10, fatigue 2/5.",
      "Eating (last 3 days, 1 logged): 85% of calorie target, protein 83% of target.",
      "Water about 1.8 L a day (last 3 days).",
      "Classes: attended 1 of their last 1 booked.",
    ]);
    expect(brief.healthNote?.note).toBe("Tight calf");
    expect(buildClassBrief(inputs()).lines).toEqual(["No training logged yet.", "No check-in in the last 3 days.", "Food not logged in the last 3 days.", "Water not logged in the last 3 days."]);
  });
});
