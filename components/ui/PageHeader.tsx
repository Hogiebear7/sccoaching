// The one page-header pattern: left-aligned eyebrow / display title /
// muted subtitle with fixed spacing, and a consistent gap to the first
// card below. Every main tab (member + staff) renders through this.
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  // Spacing below comes from the page container (space-y-8), so headers and
  // cards keep one consistent rhythm.
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="label-caps">{eyebrow}</p>}
        <h1 className={`text-display text-[28px] leading-tight text-foreground ${eyebrow ? "mt-1" : ""}`}>
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0 pb-1">{action}</div>}
    </div>
  );
}
