import type { PhaseEstimate } from "@/lib/cycle-phase";
import { CyclePhaseChart } from "./CyclePhaseChart";

// Shared by the Cycle page (full settings + this card), the Recovery page
// (this card alongside the daily check-in), and the staff member detail page
// — one source for the phase visualisation and guidance copy so the surfaces
// can't drift apart.
//
// revealExactPosition controls whether the exact cycle-day count and the
// timeline's precise "Today" marker are shown. Both the member's own views
// pass true (it's their own data). The staff page passes it only when the
// member has separately opted in to sharing exact dates with their coach —
// a coach who's been granted "share phase only" should see the phase label
// and guidance, never the day-level position, since that's precise enough to
// infer exact dates over a few visits.
export function CyclePhaseCard({
  phaseEstimate,
  periodLengthDays,
  revealExactPosition = true,
}: {
  phaseEstimate: PhaseEstimate;
  periodLengthDays: number | null;
  revealExactPosition?: boolean;
}) {
  if (phaseEstimate.phase === "Unknown") return null;
  const hasPosition = phaseEstimate.cycleDay !== null && phaseEstimate.cycleLength !== null;

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">Estimated phase: {phaseEstimate.phaseLabel}</h3>
        {revealExactPosition && hasPosition && (
          <span className="text-sm text-muted-foreground">
            Approx. day {phaseEstimate.cycleDay} of {phaseEstimate.cycleLength}
          </span>
        )}
      </div>

      {revealExactPosition && hasPosition && (
        <div className="mt-5">
          <CyclePhaseChart
            cycleDay={phaseEstimate.cycleDay as number}
            cycleLength={phaseEstimate.cycleLength as number}
            periodLengthDays={periodLengthDays}
            currentPhase={phaseEstimate.phase}
          />
        </div>
      )}

      <p className="mt-4 text-sm text-foreground">{phaseEstimate.explanation}</p>

      {phaseEstimate.confidence === "low" && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">
          Your cycle regularity is set to irregular or unsure — treat this estimate as a rough
          reference only. Individual experience varies significantly.
        </p>
      )}

      <div className="mt-4 space-y-2 border-t border-border pt-4">
        <GuidanceRow label="Training" value={phaseEstimate.trainingGuidance} />
        <GuidanceRow label="Intensity" value={phaseEstimate.intensityGuidance} />
        <GuidanceRow label="Recovery" value={phaseEstimate.recoveryGuidance} />
      </div>

      <p className="mt-4 text-xs text-muted-foreground/60">
        Educational guidance only — not medical advice. This estimate is based on the cycle
        information you have entered and may not reflect your individual experience. Cycle phases
        vary between people and from month to month.
      </p>
    </div>
  );
}

function GuidanceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-20 shrink-0 pt-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
