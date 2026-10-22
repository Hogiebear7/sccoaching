// Shared page-header pattern: eyebrow capsule, Teko headline title (matching
// the other member page titles), muted subtitle. Used by member Messages and
// the staff exercise library.
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
          <p className="chip label-caps w-fit border-primary/25 bg-primary/[0.08] !text-primary">
            {eyebrow}
          </p>
        )}
        <h1 className={`text-headline text-[40px] sm:text-[48px] ${eyebrow ? "mt-3" : ""}`}>
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
