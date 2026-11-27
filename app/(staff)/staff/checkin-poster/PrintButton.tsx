"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
      Print the poster
    </button>
  );
}
