interface Props {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export default function EmptyState({ icon, title, description, action, className = "" }: Props) {
  return (
    <div className={`flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center ${className}`}>
      {icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.03] text-zinc-500 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold tracking-tight text-zinc-200">{title}</p>
      {description && <p className="max-w-[280px] text-[13px] leading-relaxed text-zinc-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
