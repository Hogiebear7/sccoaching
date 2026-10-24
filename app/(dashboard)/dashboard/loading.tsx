// Member-app route loading state: a calm skeleton in the screen's own
// rhythm (section label, Teko title block, two cards) so navigating between
// tabs never flashes an empty page. Shimmer stops under reduced motion
// (global rule in globals.css).
export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Loading" className="space-y-10">
      <div>
        <div className="skeleton h-3 w-20" />
        <div className="skeleton mt-3 h-10 w-56" />
        <div className="skeleton mt-3 h-4 w-72 max-w-full" />
      </div>
      <div className="surface-card p-5 sm:p-6">
        <div className="flex items-start gap-5">
          <div className="skeleton h-[88px] w-[88px] shrink-0 rounded-full" />
          <div className="flex-1 space-y-3 pt-1">
            <div className="skeleton h-6 w-32" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-3/4" />
          </div>
        </div>
        <div className="skeleton mt-6 h-11 w-full sm:w-48" />
      </div>
      <div className="surface-card space-y-3 p-5 sm:p-6">
        <div className="skeleton h-4 w-40" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-2/3" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
