import { ListGroup, ListRow } from "./ListGroup";

// Phone-only account hub shown on the Profile screen (the avatar in the app
// bar leads here): the club and account pages that aren't bottom tabs, and
// Log out. Desktop has the same links in the sidebar, so it is hidden there.
export function AccountMenu() {
  return (
    <nav aria-label="Account" className="lg:hidden">
      <ListGroup>
        <ListRow href="/dashboard/membership" icon="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" title="Membership" detail="Plan, passes and billing" />
        <ListRow href="/dashboard/bookings" icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" title="Bookings" detail="Upcoming and past classes" />
        <ListRow href="/dashboard/exercise-library" icon="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" title="Exercise library" detail="Demos, cues and muscles" />
        <ListRow href="/dashboard/settings" icon="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z" title="Settings" detail="Notifications, appearance, account" />
      </ListGroup>
      <form action="/api/auth/logout" method="POST" className="mt-3">
        <button
          type="submit"
          className="flex min-h-12 w-full items-center justify-center rounded-[3px] border border-white/[0.14] text-sm font-semibold text-zinc-200 transition-colors duration-150 hover:border-white/[0.3] hover:text-white"
        >
          Log out
        </button>
      </form>
    </nav>
  );
}
