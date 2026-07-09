// The one page-header pattern (v5 "carbon instrument"): teal kicker bar +
// caps eyebrow, uppercase athletic title, muted subtitle, and a fading
// hairline rule that separates the header from the first module. Every main
// tab (member + staff) renders through this.
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
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow && (
            <p className="flex items-center gap-2">
              <span aria-hidden="true" className="h-3 w-[3px] rounded-[1px] bg-teal-400" />
              <span className="label-caps">{eyebrow}</span>
            </p>
          )}
          <h1 className={`title-athletic text-[26px] leading-none text-foreground ${eyebrow ? "mt-2.5" : ""}`}>
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {action && <div className="flex-shrink-0 pb-1">{action}</div>}
      </div>
      <div aria-hidden="true" className="mt-5 h-px bg-gradient-to-r from-white/[0.14] via-white/[0.06] to-transparent" />
    </div>
  );
}
