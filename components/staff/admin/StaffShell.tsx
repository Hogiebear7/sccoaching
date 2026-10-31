"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { UnreadMessagesBadge } from "@/components/staff/UnreadMessagesBadge";
import { AdminIcon, type AdminIconName } from "./icons";

// The admin area's frame (DESIGN.md "Admin area"): a navy sidebar with icon links grouped by job, a light workspace, and a top bar with
// where you are, a jump-to menu (Ctrl+K / ⌘K) and the account menu. Below lg the sidebar becomes a drawer. The nav items arrive already
// filtered by the signed-in role (app/(staff)/staff/layout.tsx); every destination still re-checks its own capability on the server.

export interface StaffShellNavItem {
  label: string;
  href: string;
  icon: AdminIconName;
  /** Shown in the jump-to menu under the label. */
  hint?: string;
}

export interface StaffShellSection {
  title: string;
  items: StaffShellNavItem[];
}

export interface StaffShellUser {
  name: string;
  email: string;
  role: string;
  initials: string;
}

function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const BADGE = "ml-auto rounded-full bg-[#c6a15b] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#0a1526]";

function SidebarNav({ sections, pathname, onNavigate }: { sections: StaffShellSection[]; pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Admin" className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">{section.title}</p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const current = isCurrent(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={current ? "page" : undefined}
                    className={`group relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-[14px] font-medium transition-colors duration-150 ${
                      current ? "bg-white/[0.08] text-white" : "text-white/70 hover:bg-white/[0.05] hover:text-white"
                    }`}
                  >
                    {current ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-[#c6a15b]" /> : null}
                    <AdminIcon
                      name={item.icon}
                      className={`h-[18px] w-[18px] shrink-0 ${current ? "text-[#c6a15b]" : "text-white/55 group-hover:text-white/80"}`}
                    />
                    <span className="truncate">{item.label}</span>
                    {item.href === "/staff/messages" ? <UnreadMessagesBadge className={BADGE} /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/staff/operations" className="flex items-center gap-3 px-5 py-5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/website-logo-v2.png" alt="S&C Performance Coaching" width={160} height={74} className="h-9 w-auto" />
      <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">Admin</span>
    </Link>
  );
}

function UserCard({ user }: { user: StaffShellUser }) {
  return (
    <div className="border-t border-white/[0.08] p-3">
      <div className="flex items-center gap-3 rounded-lg bg-white/[0.04] p-3">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#c6a15b] text-[13px] font-semibold text-[#0a1526]">
          {user.initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium text-white">{user.name}</p>
          <p className="truncate text-[12px] text-white/55">{user.role}</p>
        </div>
      </div>
    </div>
  );
}

// Jump-to menu: every page the role can open, plus the member view, filtered as you type. Arrow keys move, Enter opens, Esc closes.
function JumpMenu({ onClose, sections }: { onClose: () => void; sections: StaffShellSection[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const entries = useMemo(() => {
    const all = [
      ...sections.flatMap((s) => s.items.map((i) => ({ ...i, group: s.title }))),
      { label: "Member view", href: "/dashboard", icon: "member-view" as AdminIconName, group: "Account", hint: "Your own member dashboard" },
    ];
    const q = query.trim().toLowerCase();
    return q ? all.filter((e) => `${e.label} ${e.group} ${e.hint ?? ""}`.toLowerCase().includes(q)) : all;
  }, [sections, query]);

  function go(href: string) {
    onClose();
    router.push(href);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[#0a1526]/40 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Jump to a page"
        className="w-full max-w-lg overflow-hidden rounded-xl border border-[#dfe4ec] bg-white shadow-[0_24px_64px_-16px_rgba(10,21,38,0.45)]"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, entries.length - 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          }
          if (e.key === "Enter" && entries[active]) {
            e.preventDefault();
            go(entries[active].href);
          }
        }}
      >
        <div className="flex items-center gap-3 border-b border-[#e6eaf1] px-4">
          <AdminIcon name="search" className="h-5 w-5 text-[#66738a]" />
          <input
            autoFocus
            style={{ outline: "none" }}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Jump to a page…"
            aria-label="Jump to a page"
            className="h-14 w-full bg-transparent text-[15px] text-[#0a1526] outline-none placeholder:!text-[#8a96aa]"
          />
          <kbd className="rounded border border-[#dfe4ec] px-1.5 py-0.5 text-[11px] text-[#66738a]">Esc</kbd>
        </div>
        <ul role="listbox" aria-label="Pages" className="max-h-[50vh] overflow-y-auto p-2">
          {entries.length === 0 ? <li className="px-3 py-6 text-center text-sm text-[#66738a]">No page matches “{query}”.</li> : null}
          {entries.map((e, i) => (
            <li key={e.href} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(e.href)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${i === active ? "bg-[#eef2f7]" : ""}`}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#0a1526] text-[#c6a15b]">
                  <AdminIcon name={e.icon} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-[#0a1526]">{e.label}</span>
                  <span className="block truncate text-[12px] text-[#66738a]">{e.hint ?? e.group}</span>
                </span>
                {i === active ? <AdminIcon name="chevron-right" className="h-4 w-4 text-[#66738a]" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function StaffShell({ sections, user, children }: { sections: StaffShellSection[]; user: StaffShellUser; children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const currentItem = sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.title }))).find((i) => isCurrent(pathname, i.href));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setJumpOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  return (
    <div className="min-h-screen bg-[#f4f6fa]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col bg-[#0a1526] lg:flex">
        <Brand />
        <SidebarNav sections={sections} pathname={pathname} />
        <UserCard user={user} />
      </aside>

      {/* Phone/tablet drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-[#0a1526]/50" onClick={() => setDrawerOpen(false)} />
          <aside className="relative flex h-full w-[84%] max-w-[300px] flex-col bg-[#0a1526] shadow-2xl">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="grid h-11 w-11 place-items-center rounded-lg text-white/70 hover:bg-white/[0.06] hover:text-white"
              >
                <AdminIcon name="close" />
              </button>
            </div>
            <SidebarNav sections={sections} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
            <UserCard user={user} />
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-[264px]" data-staff-app="">
        <header className="sticky top-0 z-20 border-b border-[#e6eaf1] bg-[#ffffff]">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="grid h-11 w-11 place-items-center rounded-lg text-[#0a1526] hover:bg-[#eef2f7] lg:hidden"
            >
              <AdminIcon name="menu" />
            </button>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium text-[#66738a]">{currentItem?.section ?? "Admin"}</p>
              <p className="truncate text-[15px] font-semibold text-[#0a1526]">{currentItem?.label ?? "Admin"}</p>
            </div>

            <button
              type="button"
              onClick={() => setJumpOpen(true)}
              className="hidden h-10 w-64 items-center gap-2 rounded-lg border border-[#dfe4ec] bg-[#f7f9fc] px-3 text-[14px] text-[#66738a] transition-colors hover:border-[#c9d1dd] md:flex"
            >
              <AdminIcon name="search" className="h-4 w-4" />
              <span className="flex-1 text-left">Jump to…</span>
              <kbd className="rounded border border-[#dfe4ec] bg-[#ffffff] px-1.5 text-[11px]">Ctrl K</kbd>
            </button>
            <button
              type="button"
              onClick={() => setJumpOpen(true)}
              aria-label="Jump to a page"
              className="grid h-11 w-11 place-items-center rounded-lg text-[#0a1526] hover:bg-[#eef2f7] md:hidden"
            >
              <AdminIcon name="search" />
            </button>

            <Link
              href="/dashboard"
              className="hidden h-10 items-center gap-2 rounded-lg border border-[#dfe4ec] px-3 text-[14px] font-medium text-[#0a1526] transition-colors hover:bg-[#f7f9fc] sm:flex"
            >
              <AdminIcon name="member-view" className="h-4 w-4" />
              Member view
            </Link>

            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Account menu"
                className="grid h-10 w-10 place-items-center rounded-full bg-[#0a1526] text-[13px] font-semibold text-[#c6a15b] ring-offset-2 hover:ring-2 hover:ring-[#c6a15b]/60"
              >
                {user.initials}
              </button>
              {menuOpen ? (
                <>
                  <button type="button" aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-30 cursor-default" onClick={() => setMenuOpen(false)} />
                  <div
                    role="menu"
                    className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border border-[#dfe4ec] bg-[#ffffff] shadow-[0_18px_48px_-12px_rgba(10,21,38,0.35)]"
                  >
                    <div className="border-b border-[#eef1f6] px-4 py-3">
                      <p className="truncate text-[14px] font-semibold text-[#0a1526]">{user.name}</p>
                      <p className="truncate text-[12px] text-[#66738a]">{user.email}</p>
                      <p className="mt-1 text-[12px] font-medium text-[#8a6a2f]">{user.role}</p>
                    </div>
                    <Link role="menuitem" href="/dashboard" className="flex items-center gap-3 px-4 py-2.5 text-[14px] text-[#0a1526] hover:bg-[#f4f6fa]" onClick={() => setMenuOpen(false)}>
                      <AdminIcon name="member-view" className="h-4 w-4 text-[#66738a]" />
                      Member view
                    </Link>
                    <form action="/api/auth/logout" method="POST">
                      <button role="menuitem" type="submit" className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] text-[#b4232b] hover:bg-[#fdf2f2]">
                        <AdminIcon name="logout" className="h-4 w-4" />
                        Log out
                      </button>
                    </form>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>

      {jumpOpen ? <JumpMenu onClose={() => setJumpOpen(false)} sections={sections} /> : null}
    </div>
  );
}
