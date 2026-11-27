// Runtime branding for a tenant gym: a display name (already on the gym), a logo and one accent colour. The core product structure is the same for every gym; branding only
// changes the logo, the name and the accent. It can never override readability: an accent that would be hard to read on the app's dark background is refused, and every
// surface falls back to the S&C defaults when a gym has set nothing (see docs/white-label-platform-master-plan.md, "Branding and tenant experience").

import type { GymBranding, GymRecord } from "./gyms-schema";

/** The S&C accent (the gold used across the app and website). The fallback for any gym with no accent of its own. */
export const DEFAULT_ACCENT = "#C9A24B";

/** The dark ground the accent is read against in the app and the member web area. */
const APP_BACKGROUND = "#0A1526";

/** WCAG contrast for text on the dark ground. 4.5 is the normal-text AA level. */
export const MIN_ACCENT_CONTRAST = 4.5;

const HEX = /^#[0-9a-fA-F]{6}$/;

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on top of the accent (button text). */
export function readableOn(hex: string): "#0A1526" | "#FFFFFF" {
  return contrastRatio(hex, "#FFFFFF") >= contrastRatio(hex, "#0A1526") ? "#FFFFFF" : "#0A1526";
}

export type BrandingResult = { ok: true; branding: GymBranding } | { ok: false; message: string };

/**
 * Checks what a gym owner sent. `accentColor` and `logoUrl` may each be a value or null (null clears it back to the default). Anything not given keeps its current value.
 * The logo must be an https address of a png, jpg, webp or svg image (no data addresses, no scripts, nothing that is not plain https).
 */
export function validateBranding(input: unknown, current: GymBranding | undefined): BrandingResult {
  const body = (input ?? {}) as Record<string, unknown>;
  const next: GymBranding = { accentColor: current?.accentColor ?? null, logoUrl: current?.logoUrl ?? null, logoBackground: current?.logoBackground ?? null };

  if ("logoBackground" in body) {
    const v = body.logoBackground;
    if (v === null || v === "light" || v === "dark") next.logoBackground = v;
    else if (typeof v === "string" && HEX.test(v.trim())) next.logoBackground = v.trim().toUpperCase();
    else return { ok: false, message: "Logo background must be light, dark, or a colour like #000000." };
  }

  if ("accentColor" in body) {
    const v = body.accentColor;
    if (v === null) next.accentColor = null;
    else if (typeof v === "string" && HEX.test(v.trim())) {
      const hex = v.trim().toUpperCase();
      const ratio = contrastRatio(hex, APP_BACKGROUND);
      if (ratio < MIN_ACCENT_CONTRAST) {
        return { ok: false, message: `That colour is too dark to read on the app's dark background (contrast ${ratio.toFixed(1)}:1, needs ${MIN_ACCENT_CONTRAST}:1). Pick a lighter shade.` };
      }
      next.accentColor = hex;
    } else {
      return { ok: false, message: "Accent colour must look like #C9A24B (a # and six letters or digits), or null to use the default." };
    }
  }

  if ("logoUrl" in body) {
    const v = body.logoUrl;
    if (v === null) next.logoUrl = null;
    else if (typeof v === "string" && current?.logoUrl && v.trim() === current.logoUrl) {
      // Unchanged (for example the gym's own uploaded logo, which is served from this site and has no file extension in its link): keep it.
      next.logoUrl = current.logoUrl;
    } else if (typeof v === "string") {
      const url = v.trim();
      let parsed: URL | null = null;
      try {
        parsed = new URL(url);
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.protocol !== "https:" || url.length > 500 || parsed.username || parsed.password || !/\.(png|jpe?g|webp|svg)$/i.test(parsed.pathname)) {
        return { ok: false, message: "Logo must be an https link to a .png, .jpg, .webp or .svg image (at most 500 characters), or null to remove it." };
      }
      next.logoUrl = parsed.toString();
    } else {
      return { ok: false, message: "Logo must be an https link, or null to remove it." };
    }
  }

  if (!("accentColor" in body) && !("logoUrl" in body) && !("logoBackground" in body)) {
    return { ok: false, message: "Send accentColor, logoUrl and/or logoBackground." };
  }
  return { ok: true, branding: next };
}

export const LOGO_BACKGROUND_DARK = "#0A1526";
export const LOGO_BACKGROUND_LIGHT = "#FFFFFF";

/** The colour a stored choice means: "light" is white, a #RRGGBB is itself, anything else (including nothing) is the app's navy. */
export function logoBackgroundColour(value: string | null | undefined): string {
  if (value === "light") return LOGO_BACKGROUND_LIGHT;
  if (typeof value === "string" && HEX.test(value)) return value.toUpperCase();
  return LOGO_BACKGROUND_DARK;
}

export interface ResolvedBranding {
  name: string;
  /** Always a valid hex, the S&C gold when the gym has not set one. */
  accentColor: string;
  /** Text colour that reads on top of the accent. */
  onAccent: string;
  logoUrl: string | null;
  /** The colour the logo is shown on: the app's navy unless the gym chose white or a colour of its own. Always a #RRGGBB. */
  logoBackground: string;
  /** True when this is the gym's own branding rather than the S&C default. */
  custom: boolean;
}

/** What every surface renders with. A gym that has set nothing (and the primary gym) gets the S&C look. */
export function resolveBranding(gym: Pick<GymRecord, "name" | "branding"> | undefined | null): ResolvedBranding {
  const accent = gym?.branding?.accentColor && HEX.test(gym.branding.accentColor) ? gym.branding.accentColor : DEFAULT_ACCENT;
  const logoUrl = gym?.branding?.logoUrl ?? null;
  return {
    name: gym?.name ?? "S&C Performance Coaching",
    accentColor: accent,
    onAccent: readableOn(accent),
    logoUrl,
    logoBackground: logoBackgroundColour(gym?.branding?.logoBackground),
    custom: Boolean(gym?.branding?.accentColor || gym?.branding?.logoUrl),
  };
}
