"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  {
    href: "/admin", label: "Overview",
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
  },
  {
    href: "/admin/members", label: "Members",
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  },
  {
    href: "/admin/inbox", label: "Inbox",
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>,
  },
  {
    href: "/admin/resources", label: "Resources",
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" /></svg>,
  },
  {
    href: "/admin/reports", label: "Reports",
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" /></svg>,
  },
  {
    href: "/admin/analytics", label: "Analytics",
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12" /></svg>,
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-56 flex-shrink-0 h-screen bg-zinc-950 border-r border-zinc-800 flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-zinc-800">
        <span className="text-lg font-bold text-zinc-50 tracking-tight">Iron<span className="text-teal-400">Flow</span></span>
        <p className="text-[10px] text-zinc-500 mt-0.5">Coach Dashboard</p>
      </div>
      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {nav.map((item) => {
          const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${active ? "bg-teal-600/15 text-teal-400 border border-teal-600/20" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"}`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>
      {/* Coach profile */}
      <div className="px-4 py-4 border-t border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-teal-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">SO</div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-zinc-200 truncate">Coach Sarah</p>
            <p className="text-[10px] text-zinc-500">Admin</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
