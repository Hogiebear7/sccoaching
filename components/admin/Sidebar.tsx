"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; icon: React.ReactNode };

const groups: { title: string; items: NavItem[] }[] = [
  {
    title: "General",
    items: [
      {
        href: "/admin", label: "Overview",
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
      },
      {
        href: "/admin/analytics", label: "Analytics",
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12" /></svg>,
      },
      {
        href: "/admin/reports", label: "Reports",
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4"><path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" /></svg>,
      },
    ],
  },
  {
    title: "Manage",
    items: [
      {
        href: "/admin/members", label: "Members",
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
      },
      {
        href: "/admin/inbox", label: "Inbox",
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>,
      },
      {
        href: "/admin/resources", label: "Resources",
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" /></svg>,
      },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex h-screen w-[232px] flex-shrink-0 flex-col border-r border-white/[0.06] bg-[--sidebar]">
      {/* Wordmark */}
      <div className="px-5 pt-6 pb-5">
        <span className="text-display text-lg text-zinc-50">S<span className="text-teal-400">&</span>C</span>
        <p className="label-caps mt-1.5 text-[10px]">Performance Coaching · Coach</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-6 px-3 py-2">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="label-caps px-3 pb-2 text-[10px]">{group.title}</p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150 ${
                      active
                        ? "bg-white/[0.06] text-zinc-50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
                        : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
                    }`}
                  >
                    <span className={`absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-blue-400 transition-opacity duration-150 ${active ? "opacity-100" : "opacity-0"}`} />
                    <span className={`transition-colors duration-150 ${active ? "text-blue-300" : "text-zinc-500 group-hover:text-zinc-300"}`}>
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Coach profile */}
      <div className="px-3 pb-4">
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-teal-500 to-teal-600 text-[11px] font-semibold text-white ring-1 ring-white/15">SO</div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-tight text-zinc-200">Coach Sarah</p>
            <p className="mt-0.5 text-[11px] leading-tight text-zinc-500">Admin</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
