import { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

const variants = {
  primary:   "bg-teal-600 text-white hover:bg-teal-500 active:bg-teal-700",
  secondary: "border border-zinc-700 text-zinc-200 hover:border-zinc-500 hover:text-white",
  ghost:     "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800",
  danger:    "bg-red-600/20 text-red-400 border border-red-600/40 hover:bg-red-600/30",
};

const sizes = {
  sm: "h-8 px-3 text-xs rounded-lg",
  md: "h-10 px-4 text-sm rounded-xl",
  lg: "h-12 px-6 text-base rounded-xl",
};

export default function Button({ variant = "primary", size = "md", className = "", children, ...props }: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
