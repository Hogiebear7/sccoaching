type Variant = "active" | "inactive" | "premium" | "elite" | "basic" | "hiit" | "strength" | "yoga" | "mobility" | "crossfit" | "mixed" | "pdf" | "video" | "program";

/* Status variants render as dot + label (quieter, more product-grade);
   category variants render as tinted pills. */
const DOT_VARIANTS: Partial<Record<Variant, string>> = {
  active:   "bg-teal-400",
  inactive: "bg-zinc-500",
};

const styles: Record<Variant, string> = {
  active:   "border-white/[0.1] bg-white/[0.05] text-zinc-300",
  inactive: "border-white/[0.06] bg-transparent text-zinc-500",
  premium:  "bg-violet-500/10 text-violet-300 border-violet-500/25",
  elite:    "bg-amber-500/10 text-amber-300 border-amber-500/25",
  basic:    "bg-zinc-500/10 text-zinc-400 border-zinc-500/25",
  hiit:     "bg-orange-500/10 text-orange-300 border-orange-500/25",
  strength: "bg-teal-500/10 text-teal-400 border-teal-500/25",
  yoga:     "bg-purple-500/10 text-purple-300 border-purple-500/25",
  mobility: "bg-blue-500/10 text-blue-300 border-blue-500/25",
  crossfit: "bg-red-500/10 text-red-400 border-red-500/25",
  mixed:    "bg-zinc-500/10 text-zinc-300 border-zinc-500/25",
  pdf:      "bg-zinc-500/10 text-zinc-400 border-zinc-500/25",
  video:    "bg-teal-500/10 text-teal-400 border-teal-500/25",
  program:  "bg-violet-500/10 text-violet-300 border-violet-500/25",
};

interface Props {
  variant?: Variant;
  children: React.ReactNode;
  className?: string;
}

export default function Badge({ variant = "basic", children, className = "" }: Props) {
  const dot = DOT_VARIANTS[variant];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[11px] font-medium leading-none tracking-[0.01em] ${styles[variant]} ${className}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
      {children}
    </span>
  );
}
