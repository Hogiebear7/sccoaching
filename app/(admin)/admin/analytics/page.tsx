import TopBar from "@/components/admin/TopBar";
import AttendanceHeatmap from "@/components/admin/AttendanceHeatmap";
import AttendanceBarChart from "@/components/admin/AttendanceBarChart";
import FrequentMembersList from "@/components/admin/FrequentMembersList";
import { attendanceByHour, weeklyAttendance, members } from "@/lib/mock-data";

const peakDay = "Monday";
const peakTime = "6:00 – 7:00pm";
const totalThisWeek = weeklyAttendance[weeklyAttendance.length - 1].count;
const prevWeek = weeklyAttendance[weeklyAttendance.length - 2].count;
const weekChange = (((totalThisWeek - prevWeek) / prevWeek) * 100).toFixed(1);

export default function AnalyticsPage() {
  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar title="Analytics" subtitle="Attendance and engagement insights" />
      <div className="flex-1 overflow-y-auto px-8 py-8">
        {/* Call-out stats */}
        <div className="anim-rise grid grid-cols-3 gap-4 mb-8">
          <div className="panel p-4">
            <p className="label-caps">This Week</p>
            <p className="text-display text-2xl text-zinc-50 mt-2 tabular-nums">{totalThisWeek}</p>
            <p className={`text-xs mt-1.5 font-medium tabular-nums ${parseFloat(weekChange) >= 0 ? "text-teal-400" : "text-red-400"}`}>
              {parseFloat(weekChange) >= 0 ? "↑" : "↓"} {Math.abs(parseFloat(weekChange))}% vs last week
            </p>
          </div>
          <div className="panel p-4">
            <p className="label-caps">Busiest Day</p>
            <p className="text-display text-2xl text-zinc-50 mt-2">{peakDay}</p>
            <p className="text-xs text-zinc-600 mt-1.5">Consistently highest attendance</p>
          </div>
          <div className="panel p-4">
            <p className="label-caps">Peak Time</p>
            <p className="text-display text-2xl text-zinc-50 mt-2">6–7pm</p>
            <p className="text-xs text-zinc-600 mt-1.5">Mon, Wed, Fri evenings</p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Heatmap */}
          <div className="panel p-5">
            <h2 className="text-sm font-semibold tracking-tight text-zinc-200 mb-1">Attendance by Hour & Day</h2>
            <p className="text-xs text-zinc-500 mb-4">Visit count per time slot</p>
            <AttendanceHeatmap cells={attendanceByHour} />
          </div>

          {/* Weekly bar chart */}
          <div className="panel p-5">
            <h2 className="text-sm font-semibold tracking-tight text-zinc-200 mb-1">Weekly Attendance Trend</h2>
            <p className="text-xs text-zinc-500 mb-4">Total visits per week (12 weeks)</p>
            <AttendanceBarChart data={weeklyAttendance} />
          </div>

          {/* Frequent members */}
          <div className="panel p-5 xl:col-span-2">
            <h2 className="text-sm font-semibold tracking-tight text-zinc-200 mb-1">Most Frequent Members</h2>
            <p className="text-xs text-zinc-500 mb-4">Ranked by total visit count</p>
            <FrequentMembersList members={members} />
          </div>
        </div>
      </div>
    </div>
  );
}
