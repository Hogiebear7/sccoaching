import { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

const variants = {
  primary:
    "bg-teal-500 text-white border border-teal-400/50 " +
    "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_1px_2px_0_rgba(0,0,0,0.4)] " +
    "hover:bg-teal-400 active:from-teal-600 active:to-teal-600",
  secondary:
    "border border-white/[0.1] bg-white/[0.04] text-zinc-200 " +
    "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] " +
    "hover:bg-white/[0.07] hover:border-white/[0.16] hover:text-white",
  ghost:
    "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]",
  danger:
    "bg-red-500/10 text-red-400 border border-red-500/25 hover:bg-red-500/15 hover:border-red-500/40",
};

const sizes = {
  sm: "h-8 px-3 text-xs rounded-lg",
  md: "h-10 px-4 text-sm rounded-lg",
  lg: "h-12 px-6 text-[15px] rounded-lg",
};

export default function Button({ variant = "primary", size = "md", className = "", children, ...props }: Props) {
  return (
    <button
      className={
        "inline-flex items-center justify-center gap-2 font-medium tracking-[-0.006em] select-none " +
        "transition-[background-color,border-color,color,transform,box-shadow] duration-150 " +
        "active:translate-y-px " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 " +
        `disabled:opacity-40 disabled:cursor-not-allowed disabled:active:translate-y-0 ${variants[variant]} ${sizes[size]} ${className}`
      }
      {...props}
    >
      {children}
    </button>
  );
}
