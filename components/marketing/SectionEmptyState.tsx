// Designed fallback for live-data-dependent marketing sections (Training
// Floor, Membership) when the real DB has nothing to show yet. Renders
// INSIDE the section's normal wrapper, below the section's own eyebrow/
// heading (so there's exactly one header per section, not a duplicate) —
// page rhythm/spacing stays identical whether the section is populated or
// empty. Never a fabricated schedule or package, always a real next action.

export function SectionEmptyState({
  body,
  ctaLabel,
  ctaHref,
}: {
  body: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <div className="relative border border-white/[0.08] bg-[var(--surface-1)] px-8 py-14 text-center">
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary to-transparent" />
      <p className="mx-auto max-w-md text-sm leading-relaxed text-zinc-400">{body}</p>
      <a
        href={ctaHref}
        className="mt-6 inline-flex items-center justify-center rounded-[3px] bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-[background-color] duration-150 hover:bg-[var(--primary-hover)]"
      >
        {ctaLabel}
      </a>
    </div>
  );
}
