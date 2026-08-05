import type { PhaseName } from "@/lib/cycle-phase";
import { phaseSegments } from "@/lib/cycle-phase";

// Fixed, theme-aware color per phase — reuses the app's existing semantic
// accent tokens (same ones ReadinessSparkline etc. already use) rather than
// inventing new hex values, so it stays correct across every theme/palette.
const PHASE_COLOR: Record<Exclude<PhaseName, "Unknown">, string> = {
  Menstrual: "var(--danger)",
  Follicular: "var(--accent-data)",
  Ovulatory: "var(--accent-premium)",
  Luteal: "var(--warning)",
};

export function CyclePhaseChart({
  cycleDay,
  cycleLength,
  periodLengthDays,
  currentPhase,
}: {
  cycleDay: number;
  cycleLength: number;
  periodLengthDays: number | null;
  currentPhase: Exclude<PhaseName, "Unknown">;
}) {
  const segments = phaseSegments(cycleLength, periodLengthDays);
  const markerPct = Math.min(100, Math.max(0, ((cycleDay - 0.5) / cycleLength) * 100));

  return (
    <div>
      <div className="relative pt-3">
        {/* "Today" marker */}
        <div
          className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
          style={{ left: `${markerPct}%` }}
        >
          <span className="text-[9px] font-semibold uppercase tracking-wide text-foreground">Today</span>
          <svg viewBox="0 0 8 6" className="mt-0.5 h-1.5 w-2" aria-hidden>
            <path d="M4 6 0 0h8Z" fill="var(--foreground)" />
          </svg>
        </div>

        <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={`Cycle day ${cycleDay} of ${cycleLength}, ${currentPhase} phase`}>
          {segments.map((seg) => (
            <div
              key={seg.phase}
              style={{
                flexGrow: seg.dayCount,
                flexBasis: 0,
                backgroundColor: PHASE_COLOR[seg.phase],
                opacity: seg.phase === currentPhase ? 1 : 0.35,
              }}
              className="h-full first:rounded-l-full last:rounded-r-full"
            />
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((seg) => (
          <div key={seg.phase} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor: PHASE_COLOR[seg.phase],
                opacity: seg.phase === currentPhase ? 1 : 0.4,
              }}
            />
            <span
              className={`text-xs ${
                seg.phase === currentPhase ? "font-semibold text-foreground" : "text-muted-foreground"
              }`}
            >
              {seg.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
