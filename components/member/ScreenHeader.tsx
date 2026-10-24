import type { ReactNode } from "react";

// Member-app screen header (DESIGN.md "Member app"): a short gold section
// label, the screen's name in Teko and at most one supporting line. Screens
// are named for what they are ("Recovery"), not with a slogan, so the header
// reads like an app title bar rather than a marketing hero.
export function ScreenHeader({
  section,
  title,
  subtitle,
  action,
}: {
  /** Which part of the app this screen belongs to, e.g. "Training". */
  section?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned control (e.g. "Mark all read"). */
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        {section ? <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{section}</p> : null}
        <h1 className={`text-headline text-[44px] text-zinc-50 sm:text-[52px] ${section ? "mt-1.5" : ""}`}>{title}</h1>
        {subtitle ? <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-zinc-300">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

// Small section heading used between groups on a screen: Inter caps label
// with an optional right-aligned link.
export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 id={id} className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
        {children}
      </h2>
      {action}
    </div>
  );
}
