// The one page-header pattern (v6 "liquid glass athletic"): frosted eyebrow
// capsule, liquid-metal display title, muted subtitle. Every main tab
// (member + staff) renders through this.
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
        {eyebrow && (
          <p className="chip label-caps w-fit border-teal-400/20 bg-teal-400/[0.07] !text-teal-300/90">
            {eyebrow}
          </p>
        )}
        <h1 className={`title-athletic text-[30px] leading-[1.05] ${eyebrow ? "mt-3" : ""}`}>
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
