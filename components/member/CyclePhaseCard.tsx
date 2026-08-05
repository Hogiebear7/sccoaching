import type { PhaseEstimate } from "@/lib/cycle-phase";
import { CyclePhaseChart } from "./CyclePhaseChart";

// Shared by the Cycle page (full settings + this card) and the Recovery page
// (this card alongside the daily check-in) — one source for the phase
// visualisation and guidance copy so the two surfaces can't drift apart.
export function CyclePhaseCard({
  phaseEstimate,
  periodLengthDays,
}: {
  phaseEstimate: PhaseEstimate;
  periodLengthDays: number | null;
}) {
  if (phaseEstimate.phase === "Unknown") return null;

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">Estimated phase: {phaseEstimate.phaseLabel}</h3>
        {phaseEstimate.cycleDay !== null && phaseEstimate.cycleLength !== null && (
          <span className="text-sm text-muted-foreground">
            Approx. day {phaseEstimate.cycleDay} of {phaseEstimate.cycleLength}
          </span>
        )}
      </div>

      {phaseEstimate.cycleDay !== null && phaseEstimate.cycleLength !== null && (
        <div className="mt-5">
          <CyclePhaseChart
            cycleDay={phaseEstimate.cycleDay}
            cycleLength={phaseEstimate.cycleLength}
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
