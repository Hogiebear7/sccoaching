import Link from "next/link";
import type { ReactNode } from "react";

// Settings-style grouped list (DESIGN.md "Member app"): one surface card,
// hairline dividers, 56px rows with an optional leading icon, a title, a
// supporting line, an optional trailing value or badge, and a chevron when
// the row navigates.
export function ListGroup({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <ul className={`surface-card divide-y divide-white/[0.06] overflow-hidden ${className}`}>{children}</ul>;
}

export function ListRow({
  href,
  icon,
  title,
  detail,
  trailing,
  tone = "default",
}: {
  href?: string;
  /** SVG path data for a 24px stroke icon. */
  icon?: string;
  title: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  /** "attention" tints the row for a state that needs action (e.g. lapsed plan). */
  tone?: "default" | "attention";
}) {
  const body = (
    <>
      {icon ? (
        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-[4px] bg-white/[0.05] text-primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d={icon} />
          </svg>
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-zinc-50">{title}</span>
        {detail ? <span className="mt-0.5 block truncate text-sm text-zinc-400">{detail}</span> : null}
      </span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
      {href ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4 shrink-0 text-zinc-500">
          <path d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      ) : null}
    </>
  );
  const rowClass = `flex min-h-14 items-center gap-4 px-4 py-3 sm:px-5 ${tone === "attention" ? "bg-[var(--danger-weak)]" : ""}`;
  return (
    <li>
      {href ? (
        <Link href={href} className={`${rowClass} transition-colors duration-150 hover:bg-white/[0.03]`}>
          {body}
        </Link>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  );
}

// Small status badge used as a ListRow trailing value: semantic tones only.
export function StatusBadge({ tone, children }: { tone: "neutral" | "good" | "warn" | "bad"; children: ReactNode }) {
  const cls =
    tone === "good"
      ? "border-[var(--success)]/35 text-[var(--success)]"
      : tone === "warn"
        ? "border-[var(--warning)]/35 text-[var(--warning)]"
        : tone === "bad"
          ? "border-[var(--danger)]/45 text-red-300"
          : "border-white/[0.16] text-zinc-300";
  return <span className={`inline-flex items-center rounded-[3px] border px-2 py-1 text-xs font-semibold ${cls}`}>{children}</span>;
}
