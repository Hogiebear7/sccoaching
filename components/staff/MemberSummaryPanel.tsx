import type { buildMemberSummary, MemberState } from "@/lib/member-summary";

type Summary = ReturnType<typeof buildMemberSummary>;

const STATE_LABEL: Record<MemberState, string> = {
  good: "In good shape",
  take_care: "Take care",
  caution: "Needs attention",
  no_recent_data: "Nothing logged recently",
};
const STATE_STYLE: Record<MemberState, string> = {
  good: "border-primary/30 bg-primary/10 text-primary",
  take_care: "border-gold/30 bg-gold/10 text-gold",
  caution: "border-destructive/30 bg-destructive/10 text-destructive",
  no_recent_data: "border-border bg-secondary text-muted-foreground",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const kg = (n: number | null) => (n === null ? "n/a" : `${n} kg`);
const signed = (n: number | null) => (n === null ? "n/a" : `${n > 0 ? "+" : ""}${n} kg`);
const num = (n: number | null, unit = "") => (n === null ? "n/a" : `${n}${unit}`);

// The full member summary a coach sees on a member's profile (Membership members only; the page does not render it for anyone else). Everything shown is
// worked out from what the member logs, so a blank means "not logged", not "fine".
export function MemberSummaryPanel({ summary }: { summary: Summary }) {
  const { training, classes, checkIns, nutrition, weight, flags } = summary;

  return (
    <div className="panel p-6" data-testid="member-summary">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Member summary</h3>
          <p className="mt-1 text-sm text-muted-foreground">From what they log: training, check-ins, food, water, weight and classes.</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATE_STYLE[summary.state]}`}>{STATE_LABEL[summary.state]}</span>
      </div>

      {flags.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {flags.map((f) => (
            <li
              key={f.code}
              className={`rounded-xl border px-3 py-2 text-sm ${f.severity === "caution" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-secondary"}`}
            >
              {f.text}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <section>
          <h4 className="text-sm font-semibold">Training</h4>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <Stat label="Last 7 days" value={`${training.daysTrainedLast7} day${training.daysTrainedLast7 === 1 ? "" : "s"}`} hint={training.targetDaysPerWeek ? `target ${training.targetDaysPerWeek} a week` : undefined} />
            <Stat label="Last 30 days" value={`${training.daysTrainedLast30} days`} />
            <Stat label="Last session" value={training.lastSessionDate ?? "none logged"} hint={training.daysSinceLastSession !== null ? `${training.daysSinceLastSession} day(s) ago` : undefined} />
            <Stat label="Effort (last 3 days)" value={training.effortLast3Days === "none" ? "rest" : training.effortLast3Days} hint={training.averageSessionRpeLast7 !== null ? `avg session RPE ${training.averageSessionRpeLast7} this week` : undefined} />
            <Stat label="Volume this week" value={`${training.volumeLast7Kg.toLocaleString("en-IE")} kg`} hint={`usual week ${training.averageWeeklyVolumePrev4WeeksKg.toLocaleString("en-IE")} kg`} />
            <Stat label="Sessions logged" value={String(training.totalLogged)} />
          </div>
          {training.recent.length > 0 ? (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              {training.recent.map((s) => (
                <li key={`${s.date}-${s.title}`}>
                  {s.date} · {s.title}
                  {s.rpe !== null ? ` · RPE ${s.rpe}` : ""}
                  {s.durationMins ? ` · ${s.durationMins} min` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section>
          <h4 className="text-sm font-semibold">Check-ins</h4>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <Stat label="Last 14 days" value={`${checkIns.checkInsLast14} check-in${checkIns.checkInsLast14 === 1 ? "" : "s"}`} hint={checkIns.latestDate ? `latest ${checkIns.latestDate}` : undefined} />
            <Stat label="Average readiness" value={num(checkIns.averageReadiness, "/100")} hint={checkIns.readinessTrend ? `trend: ${checkIns.readinessTrend}` : undefined} />
            <Stat label="Average sleep" value={num(checkIns.averageSleepHours, " h")} />
            <Stat label="Soreness / fatigue" value={`${num(checkIns.averageSoreness, "/10")} · ${num(checkIns.averageFatigue, "/5")}`} />
          </div>
          {checkIns.healthNote ? (
            <p className={`mt-3 rounded-xl border px-3 py-2 text-sm ${checkIns.healthNote.mentionsIllnessOrInjury ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-secondary"}`}>
              Health note ({checkIns.healthNote.date}): {checkIns.healthNote.note}
            </p>
          ) : null}
        </section>

        <section>
          <h4 className="text-sm font-semibold">Nutrition and water (last 3 full days)</h4>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <Stat label="Days food logged" value={`${nutrition.daysLoggedLast3} of 3`} hint={`${nutrition.daysLoggedLast7} of the last 7`} />
            <Stat label="Calories" value={nutrition.averageCalories === null ? "not logged" : `${nutrition.averageCalories} kcal`} hint={nutrition.caloriePercentOfTarget !== null ? `${nutrition.caloriePercentOfTarget}% of target` : nutrition.targetCalories ? `target ${nutrition.targetCalories}` : undefined} />
            <Stat label="Protein" value={nutrition.averageProteinG === null ? "not logged" : `${nutrition.averageProteinG} g`} hint={nutrition.proteinPercentOfTarget !== null ? `${nutrition.proteinPercentOfTarget}% of target` : undefined} />
            <Stat label="Water" value={nutrition.averageWaterMl === null ? "not logged" : `${(nutrition.averageWaterMl / 1000).toFixed(1)} L a day`} />
          </div>
        </section>

        <section>
          <h4 className="text-sm font-semibold">Weight</h4>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <Stat label="Latest" value={kg(weight.latestKg)} hint={weight.latestDate ?? undefined} />
            <Stat label="Change, 30 days" value={signed(weight.changeLast30DaysKg)} />
            <Stat label="Change, 90 days" value={signed(weight.changeLast90DaysKg)} hint={`${weight.weighInsLast90} weigh-ins`} />
            <Stat label="Goal" value={kg(weight.goalWeightKg)} hint={weight.kgToGoal !== null ? `${signed(weight.kgToGoal)} to go${weight.goalTargetDate ? ` by ${weight.goalTargetDate}` : ""}` : undefined} />
          </div>
        </section>

        <section className="sm:col-span-2">
          <h4 className="text-sm font-semibold">Classes</h4>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Booked, last 30 days" value={String(classes.bookedLast30)} />
            <Stat label="Attended" value={String(classes.attendedLast30)} />
            <Stat label="Missed" value={String(classes.missedLast30)} />
            <Stat label="Last attended" value={classes.lastAttendedDate ?? "none yet"} />
          </div>
          {classes.upcoming.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Next: {classes.upcoming.map((c) => `${c.title} (${c.date} ${c.startTime})`).join(" · ")}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
