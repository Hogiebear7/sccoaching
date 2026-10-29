import { buildMasterWorkbook, EXPORT_RANGES, type ExportRange } from "@/lib/exports";
import { requireStaffPage } from "@/lib/staff-auth";
import { ExportsView } from "./ExportsView";

// Reports & exports (admin revamp slice S1, docs/admin-revamp-plan-2026-10.md). Admin only (reports.view), scoped to the staff member's own
// gym. The period comes from the URL so a link can be shared; the row counts shown are those of the files the buttons download.
export default async function StaffExportsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const staff = await requireStaffPage("reports.view");
  const requested = (await searchParams).range;
  const range: ExportRange = EXPORT_RANGES.includes(requested as ExportRange) ? (requested as ExportRange) : "90d";
  const sheets = buildMasterWorkbook({ gymId: staff.gymId ?? null }, range);
  const counts = Object.fromEntries(sheets.map((s) => [s.key, s.rows.length]));
  const summary = sheets[0].rows.map((r) => ({ measure: String(r.measure), value: r.value, note: r.note === null ? null : String(r.note) }));
  return <ExportsView range={range} counts={counts} summary={summary} />;
}
