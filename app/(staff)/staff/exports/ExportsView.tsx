import Link from "next/link";

import { EXPORT_RANGE_LABEL, EXPORT_RANGES, EXPORT_SHEET_INFO, type ExportRange, type ExportSheetKey } from "@/lib/exports";

// Server-rendered: every control is a plain link, so the page works without JavaScript and each download is an ordinary file request
// (the browser keeps the session cookie). See app/api/staff/exports/route.ts.
const SHEETS: Exclude<ExportSheetKey, "summary">[] = ["members", "memberships", "classes", "bookings", "app-access"];

const href = (sheet: string, format: "csv" | "xlsx", range: ExportRange) => `/api/staff/exports?sheet=${sheet}&format=${format}&range=${range}`;

function formatValue(measure: string, value: string | number | null): string {
  if (value === null) return "—";
  if (typeof value === "string") return value;
  if (measure.includes("fill rate")) return `${Math.round(value * 1000) / 10}%`;
  if (measure.includes("(€)")) return `€${value.toFixed(2)}`;
  return value.toLocaleString("en-IE");
}

export function ExportsView({
  range,
  counts,
  summary,
}: {
  range: ExportRange;
  counts: Record<string, number>;
  summary: { measure: string; value: string | number | null; note: string | null }[];
}) {
  const plural = (n: number, word: string) => `${n.toLocaleString("en-IE")} ${word}${n === 1 ? "" : "s"}`;
  return (
    <div className="space-y-6">
      <div>
        <p className="label-caps">Staff</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">Reports &amp; exports</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Download your gym&apos;s figures as spreadsheets. The master workbook has every sheet plus a summary; each sheet also downloads on its
          own, as Excel or CSV. Everything covers your gym only.
        </p>
      </div>

      <nav aria-label="Period" className="panel flex flex-wrap items-center gap-2 p-4">
        <span className="mr-1 text-xs text-muted-foreground">Period</span>
        {EXPORT_RANGES.map((r) => (
          <Link
            key={r}
            href={`/staff/exports?range=${r}`}
            aria-current={r === range ? "page" : undefined}
            scroll={false}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              r === range ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:border-primary hover:text-foreground"
            }`}
          >
            {EXPORT_RANGE_LABEL[r]}
          </Link>
        ))}
      </nav>

      <section className="panel p-6" aria-labelledby="master-heading">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <h3 id="master-heading" className="text-lg font-semibold">
              Master workbook
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              One Excel file with a Summary sheet and every sheet below, for {EXPORT_RANGE_LABEL[range].toLowerCase()}.
            </p>
          </div>
          <a href={href("master", "xlsx", range)} download className="btn-primary shrink-0 px-4 py-2 text-sm">
            Download master workbook
          </a>
        </div>

        <dl className="mt-5 grid gap-px overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-3">
          {summary.slice(1).map((row) => (
            <div key={row.measure} className="bg-[var(--surface-1,#0d1b2e)] p-4">
              <dt className="text-xs text-muted-foreground">{row.measure}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{formatValue(row.measure, row.value)}</dd>
              {row.note ? <dd className="mt-1 text-[11px] leading-snug text-muted-foreground/80">{row.note}</dd> : null}
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="sheets-heading" className="space-y-3">
        <h3 id="sheets-heading" className="text-lg font-semibold">
          Individual sheets
        </h3>
        <ul className="grid gap-3 lg:grid-cols-2">
          {SHEETS.map((key) => {
            const info = EXPORT_SHEET_INFO[key];
            const n = counts[key] ?? 0;
            return (
              <li key={key} className="panel flex flex-col gap-3 p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h4 className="text-base font-semibold">{info.title}</h4>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {plural(n, "row")}
                    {info.usesRange ? ` · ${EXPORT_RANGE_LABEL[range].toLowerCase()}` : ""}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{info.description}</p>
                <div className="mt-auto flex flex-wrap gap-2">
                  <a href={href(key, "xlsx", range)} download className="btn-primary px-3 py-1.5 text-xs">
                    Excel
                  </a>
                  <a href={href(key, "csv", range)} download className="rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent">
                    CSV
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Phone numbers are only included for members who hold a gym Membership, the same rule as the member pages. Text that a spreadsheet would
        treat as a formula is written as plain text. Excel files open in Excel, Google Sheets and Numbers.
      </p>
    </div>
  );
}
