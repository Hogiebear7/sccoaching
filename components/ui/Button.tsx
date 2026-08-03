import { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

// Flat, sharp-cornered editorial style (index.html blueprint) — no glossy
// capsule shadows. Definition comes from color/border contrast, not gloss.
const variants = {
  primary:
    "bg-primary text-primary-foreground border border-transparent " +
    "hover:bg-[var(--primary-hover)] active:bg-[var(--primary-hover)]",
  secondary:
    "border border-white/[0.14] bg-white/[0.03] text-zinc-200 " +
    "hover:border-primary/40 hover:bg-white/[0.06] hover:text-white",
  ghost:
    "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]",
  danger:
    "bg-red-500/10 text-red-400 border border-red-500/25 hover:bg-red-500/15 hover:border-red-500/40",
};

const sizes = {
  sm: "h-8 px-3 text-xs rounded-[3px]",
  md: "h-10 px-4 text-sm rounded-[3px]",
  lg: "h-12 px-6 text-[15px] rounded-[3px]",
};

export default function Button({ variant = "primary", size = "md", className = "", children, ...props }: Props) {
  return (
    <button
      className={
        "inline-flex items-center justify-center gap-2 font-medium tracking-[-0.006em] select-none " +
        "transition-[background-color,border-color,color,transform,box-shadow] duration-150 " +
        "active:translate-y-px " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 " +
        `disabled:opacity-40 disabled:cursor-not-allowed disabled:active:translate-y-0 ${variants[variant]} ${sizes[size]} ${className}`
      }
      {...props}
    >
      {children}
    </button>
  );
}
