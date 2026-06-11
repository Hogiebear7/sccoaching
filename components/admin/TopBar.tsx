interface Props {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export default function TopBar({ title, subtitle, action }: Props) {
  return (
    <header className="bg-zinc-950 border-b border-zinc-800 px-6 py-4 flex items-center justify-between gap-4 flex-shrink-0">
      <div>
        <h1 className="text-lg font-bold text-zinc-50">{title}</h1>
        {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </header>
  );
}
