// The "Session Ledger" — this brand's signature element (from the
// index.html blueprint): testing/session data rendered like a coach's data
// sheet, in mono type, on a flat solid surface with a hairline border and a
// thin gold top accent. Deliberately NOT the app's glass panel utility —
// index.html's panels are solid, which is part of what makes it read as
// architectural/editorial rather than a generic frosted-glass dashboard.
// Data-driven so it's reusable later for a real member workout/testing log.

export type LedgerRow = {
  metric: string;
  athlete?: string;
  value: string;
  unit?: string;
  delta?: string;
  deltaDirection?: "up" | "down" | "neutral";
};

export function Ledger({
  title,
  tag,
  rows,
  footnote,
  className = "",
}: {
  title: string;
  tag: string;
  rows: LedgerRow[];
  footnote?: string;
  className?: string;
}) {
  return (
    <div
      className={`relative border border-white/[0.08] bg-[var(--surface-1)] p-6 ${className}`}
    >
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary to-transparent" />

      <div className="mb-5 flex items-baseline justify-between border-b border-white/[0.08] pb-4">
        <span className="text-editorial text-[18px] italic text-zinc-50">{title}</span>
        <span className="text-mono text-[11px] uppercase tracking-[0.08em] text-gold">{tag}</span>
      </div>

      <ul>
        {rows.map((row, i) => (
          <li
            key={row.metric}
            className={`text-mono grid grid-cols-[1.4fr_0.5fr_0.7fr_0.9fr] items-baseline gap-3 py-3 ${
              i !== rows.length - 1 ? "border-b border-white/[0.06]" : ""
            }`}
          >
            <span className="text-[13px] text-zinc-100">{row.metric}</span>
            <span className="text-[12px] text-zinc-500">{row.athlete}</span>
            <span className="text-[15px] font-semibold text-gold">
              {row.value}
              {row.unit ? <em className="ml-0.5 text-[11px] font-normal not-italic text-zinc-500">{row.unit}</em> : null}
            </span>
            <span
              className={`text-right text-[12px] ${
                row.deltaDirection === "up"
                  ? "text-[var(--success)]"
                  : row.deltaDirection === "down"
                    ? "text-[var(--danger)]"
                    : "text-zinc-500"
              }`}
            >
              {row.delta}
            </span>
          </li>
        ))}
      </ul>

      {footnote ? (
        <p className="mt-5 text-[12px] italic text-zinc-500">{footnote}</p>
      ) : null}
    </div>
  );
}
