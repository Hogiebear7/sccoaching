import Link from "next/link";

import { EXPORT_RANGE_LABEL, EXPORT_RANGES, rangeBounds, type ExportRange } from "@/lib/exports";
import { listStaffActions } from "@/lib/staff-actions";
import { requireStaffPage } from "@/lib/staff-auth";

// Staff changes (admin revamp slice S6, docs/admin-revamp-plan-2026-10.md): who changed what for which member, newest first. Admin only
// (reports.view), the acting staff member's own gym only. The same rows download as the "Staff changes" sheet on Reports & exports.
const PAGE_SIZE = 100;

export default async function StaffChangesPage({ searchParams }: { searchParams: Promise<{ range?: string; page?: string }> }) {
  const staff = await requireStaffPage("reports.view");
  const sp = await searchParams;
  const range: ExportRange = EXPORT_RANGES.includes(sp.range as ExportRange) ? (sp.range as ExportRange) : "30d";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const { start, end } = rangeBounds(range);
  const all = listStaffActions({ gymId: staff.gymId ?? null }, start, end);
  const rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-IE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });

  return (
    <div className="space-y-6">
      <div>
        <p className="label-caps">Staff</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">Staff changes</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Every change staff made to a member: free access given or withdrawn, gym Memberships, pauses, AI pauses, extra classes, archives and
          deletions. Your gym only.
        </p>
      </div>

      <nav aria-label="Period" className="panel flex flex-wrap items-center gap-2 p-4">
        <span className="mr-1 text-xs text-muted-foreground">Period</span>
        {EXPORT_RANGES.map((r) => (
          <Link
            key={r}
            href={`/staff/changes?range=${r}`}
            aria-current={r === range ? "page" : undefined}
            scroll={false}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              r === range ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:border-primary hover:text-foreground"
            }`}
          >
            {EXPORT_RANGE_LABEL[r]}
          </Link>
        ))}
        <span className="ml-auto flex gap-2">
          <a href={`/api/staff/exports?sheet=staff-changes&format=xlsx&range=${range}`} download className="btn-primary px-3 py-1.5 text-xs">
            Excel
          </a>
          <a href={`/api/staff/exports?sheet=staff-changes&format=csv&range=${range}`} download className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold">
            CSV
          </a>
        </span>
      </nav>

      <section className="panel overflow-hidden" aria-label="Changes">
        <p className="border-b border-white/[0.06] px-4 py-3 text-xs text-muted-foreground">
          {all.length.toLocaleString("en-IE")} change{all.length === 1 ? "" : "s"} in {EXPORT_RANGE_LABEL[range].toLowerCase()}
        </p>
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No staff changes in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Staff member</th>
                  <th className="px-4 py-2 font-medium">Member</th>
                  <th className="px-4 py-2 font-medium">Change</th>
                  <th className="px-4 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-white/[0.06]">
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums text-muted-foreground">{when(r.at)}</td>
                    <td className="px-4 py-2">{r.staff}</td>
                    <td className="px-4 py-2">
                      {r.member === "Deleted member" ? (
                        <span className="text-muted-foreground">{r.member}</span>
                      ) : (
                        <Link href={`/staff/members/${r.memberUserId}`} className="text-gold hover:text-gold/80">
                          {r.member}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-2">{r.action}</td>
                    <td className="px-4 py-2 text-muted-foreground">{r.detail || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 ? (
          <nav aria-label="Pages" className="flex items-center justify-between border-t border-white/[0.06] px-4 py-3 text-xs">
            {page > 1 ? <Link href={`/staff/changes?range=${range}&page=${page - 1}`} className="text-gold">← Newer</Link> : <span />}
            <span className="text-muted-foreground">
              Page {page} of {pages}
            </span>
            {page < pages ? <Link href={`/staff/changes?range=${range}&page=${page + 1}`} className="text-gold">Older →</Link> : <span />}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
