// Shared readiness score ring — used on the Home readiness module and the
// Recovery summary so the score reads identically everywhere. Color follows
// the app's semantic tokens (not literal hues) so it recolors correctly
// per palette/theme: success ≥60, data/neutral 40–59, warning <40.
export function ReadinessRing({
  score,
  size = 76,
}: {
  score: number | null;
  size?: number;
}) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const color =
    score === null
      ? "oklch(0.49 0.005 255)"
      : score >= 60
        ? "var(--success)"
        : score >= 40
          ? "var(--accent-data)"
          : "var(--warning)";

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 overflow-visible" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="oklch(1 0 0 / 0.1)"
          strokeWidth={stroke}
        />
        {score !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            style={{ filter: `drop-shadow(0 0 6px color-mix(in oklch, ${color} 50%, transparent))` }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-display text-[22px] leading-none tabular-nums">
          {score ?? "—"}
        </span>
        <span className="text-[9px] font-medium text-muted-foreground">/100</span>
      </div>
    </div>
  );
}
