import TopBar from "@/components/admin/TopBar";
import { monthlyReports } from "@/lib/mock-data";

export default function ReportsPage() {
  const totalRevenue = monthlyReports.reduce((s, r) => s + r.revenue, 0);
  const totalNew = monthlyReports.reduce((s, r) => s + r.newMembers, 0);
  const totalChurn = monthlyReports.reduce((s, r) => s + r.churnedMembers, 0);
  const avgVisits = (monthlyReports.reduce((s, r) => s + r.avgVisitsPerMember, 0) / monthlyReports.length).toFixed(1);

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar title="Reports" subtitle="2025 Annual Summary" />
      <div className="flex-1 overflow-y-auto px-8 py-8">
        {/* Summary cards */}
        <div className="anim-rise grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total Revenue", value: `$${totalRevenue.toLocaleString()}` },
            { label: "New Members", value: totalNew },
            { label: "Churned Members", value: totalChurn },
            { label: "Avg Visits/Member", value: avgVisits },
          ].map(({ label, value }) => (
            <div key={label} className="panel p-4">
              <p className="label-caps">{label}</p>
              <p className="text-display text-2xl text-zinc-50 mt-2 tabular-nums">{value}</p>
              <p className="text-xs text-zinc-600 mt-1">Jan – Dec 2025</p>
            </div>
          ))}
        </div>

        {/* Monthly table */}
        <div className="panel overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.08]">
                {["Month", "Revenue", "New Members", "Churned", "Avg Visits/Member"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left label-caps">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {monthlyReports.map((r) => (
                <tr key={r.month} className="hover:bg-white/[0.025] transition-colors duration-150">
                  <td className="px-5 py-3.5 text-[13px] font-medium text-zinc-200">{r.month}</td>
                  <td className="px-5 py-3.5 text-[13px] text-zinc-100 font-semibold tabular-nums">${r.revenue.toLocaleString()}</td>
                  <td className="px-5 py-3.5 text-[13px] text-teal-400 font-medium tabular-nums">+{r.newMembers}</td>
                  <td className="px-5 py-3.5 text-[13px] text-red-400 tabular-nums">-{r.churnedMembers}</td>
                  <td className="px-5 py-3.5 text-[13px] text-zinc-300 tabular-nums">{r.avgVisitsPerMember.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
