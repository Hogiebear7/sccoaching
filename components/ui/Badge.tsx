type Variant = "active" | "inactive" | "premium" | "elite" | "basic" | "hiit" | "strength" | "yoga" | "mobility" | "crossfit" | "mixed" | "pdf" | "video" | "program";

const styles: Record<Variant, string> = {
  active:   "bg-teal-600/20 text-teal-400 border-teal-600/30",
  inactive: "bg-zinc-700/30 text-zinc-400 border-zinc-700/40",
  premium:  "bg-violet-600/20 text-violet-300 border-violet-600/30",
  elite:    "bg-amber-600/20 text-amber-300 border-amber-600/30",
  basic:    "bg-zinc-700/30 text-zinc-400 border-zinc-700/40",
  hiit:     "bg-orange-600/20 text-orange-300 border-orange-600/30",
  strength: "bg-teal-600/20 text-teal-400 border-teal-600/30",
  yoga:     "bg-purple-600/20 text-purple-300 border-purple-600/30",
  mobility: "bg-blue-600/20 text-blue-300 border-blue-600/30",
  crossfit: "bg-red-600/20 text-red-400 border-red-600/30",
  mixed:    "bg-zinc-600/20 text-zinc-300 border-zinc-600/30",
  pdf:      "bg-zinc-700/30 text-zinc-400 border-zinc-700/40",
  video:    "bg-teal-600/20 text-teal-400 border-teal-600/30",
  program:  "bg-violet-600/20 text-violet-300 border-violet-600/30",
};

interface Props {
  variant?: Variant;
  children: React.ReactNode;
  className?: string;
}

export default function Badge({ variant = "basic", children, className = "" }: Props) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${styles[variant]} ${className}`}>
      {children}
    </span>
  );
}
