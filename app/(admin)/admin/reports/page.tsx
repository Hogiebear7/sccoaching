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
      <div className="flex-1 overflow-y-auto p-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total Revenue", value: `$${totalRevenue.toLocaleString()}` },
            { label: "New Members", value: totalNew },
            { label: "Churned Members", value: totalChurn },
            { label: "Avg Visits/Member", value: avgVisits },
          ].map(({ label, value }) => (
            <div key={label} className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium">{label}</p>
              <p className="text-2xl font-bold text-zinc-50 mt-1">{value}</p>
              <p className="text-xs text-zinc-600 mt-0.5">Jan – Dec 2025</p>
            </div>
          ))}
        </div>

        {/* Monthly table */}
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800">
                {["Month", "Revenue", "New Members", "Churned", "Avg Visits/Member"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthlyReports.map((r) => (
                <tr key={r.month} className="border-b border-zinc-800 last:border-0 hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-zinc-200">{r.month}</td>
                  <td className="px-4 py-3 text-sm text-zinc-100 font-semibold">${r.revenue.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-teal-400 font-medium">+{r.newMembers}</td>
                  <td className="px-4 py-3 text-sm text-red-400">-{r.churnedMembers}</td>
                  <td className="px-4 py-3 text-sm text-zinc-300">{r.avgVisitsPerMember.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
