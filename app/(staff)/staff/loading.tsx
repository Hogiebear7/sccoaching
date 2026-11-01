// Shown the moment a staff page is chosen, while the server builds it (every staff page is rendered per request), so a click in the sidebar
// answers at once instead of appearing to do nothing. Shaped like a page: a title, a row of figures, and two content blocks.
export default function StaffLoading() {
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="space-y-2">
        <div className="skeleton h-4 w-32 animate-pulse rounded" />
        <div className="skeleton h-8 w-64 animate-pulse rounded" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="panel p-5">
            <div className="skeleton h-4 w-24 animate-pulse rounded" />
            <div className="skeleton mt-3 h-8 w-16 animate-pulse rounded" />
            <div className="skeleton mt-3 h-4 w-40 animate-pulse rounded" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="panel h-64 animate-pulse xl:col-span-2" />
        <div className="panel h-64 animate-pulse" />
      </div>
    </div>
  );
}
