// CSV text shared by the server exports (lib/exports-format.ts) and the in-browser "Export this view" buttons. Plain TypeScript, safe in a
// client bundle.
//
// Formula injection: in a CSV, a cell that starts with = + - @ (or a tab / carriage return) is read as a formula by Excel and Sheets. Member-
// entered text (names, notes) could carry one, so such text is prefixed with an apostrophe, the standard defence.

const FORMULA_START = /^[=+\-@\t\r]/;

export function safeText(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** One cell as CSV: guarded, and quoted when it holds a comma, quote or line break. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? String(value) : safeText(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A header row and data rows as CSV text, with a byte-order mark so Excel opens accented names correctly. */
export function csvText(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return `﻿${[headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** Starts a browser download of CSV text. */
export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
