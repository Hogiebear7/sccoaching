interface Props {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export default function TopBar({ title, subtitle, action }: Props) {
  return (
    <header className="flex min-h-[72px] flex-shrink-0 items-center justify-between gap-4 border-b border-white/[0.06] bg-zinc-950/70 px-8 py-4 backdrop-blur-md">
      <div>
        <h1 className="text-display text-[17px] leading-tight text-zinc-50">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </header>
  );
}
