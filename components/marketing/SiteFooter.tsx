import Link from "next/link";

import { AUTH_ROUTES, BRAND_NAME, CONTACT_INFO } from "@/lib/content";
import { SITE_NAV } from "@/lib/site-content";

const LINK = "inline-flex min-h-11 items-center transition-colors duration-150 hover:text-gold";
const HEADING = "text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500";

// Shared footer for every public page: brand and location, the site's pages,
// direct contact, and member/legal links.
export function SiteFooter() {
  return (
    <footer className="relative border-t border-white/[0.06] bg-[var(--bg-0)]">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset, next/image's overhead isn't worth it here */}
          <img src="/brand/website-logo-v2.png" alt={BRAND_NAME} width={160} height={74} className="h-10 w-auto" />
          <p className="mt-4 max-w-[30ch] text-sm leading-relaxed text-zinc-400">
            Small-group strength and conditioning in {CONTACT_INFO.location}.
          </p>
        </div>

        <nav aria-label="Footer">
          <p className={HEADING}>Site</p>
          <ul className="mt-2 grid text-sm text-zinc-300">
            <li><Link href="/" className={LINK}>Home</Link></li>
            {SITE_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={LINK}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <p className={HEADING}>Contact</p>
          <ul className="mt-2 grid text-sm text-zinc-300">
            <li><a href={`mailto:${CONTACT_INFO.email}`} className={`${LINK} break-all`}>{CONTACT_INFO.email}</a></li>
            <li><a href={`tel:${CONTACT_INFO.phoneHref}`} className={LINK}>{CONTACT_INFO.phone}</a></li>
            <li className="flex min-h-11 items-center text-zinc-400">{CONTACT_INFO.location}</li>
          </ul>
        </div>

        <div>
          <p className={HEADING}>Members</p>
          <ul className="mt-2 grid text-sm text-zinc-300">
            <li><Link href={AUTH_ROUTES.login} className={LINK}>Member login</Link></li>
            <li><Link href={AUTH_ROUTES.signup} className={LINK}>Create account</Link></li>
            <li><Link href="/privacy" className={LINK}>Privacy</Link></li>
            <li><Link href="/terms" className={LINK}>Terms</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/[0.06]">
        <p className="mx-auto max-w-6xl px-6 py-6 text-xs text-zinc-500">© 2026 {BRAND_NAME}</p>
      </div>
    </footer>
  );
}
