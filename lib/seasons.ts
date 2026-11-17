// The seasonal look (owner plan 2026-11-17): which season the site and app should look like on a given day. Pure and dependency-free, so the website, the
// server API (GET /api/season, used by the phone app) and the tests all share it. Dates are Irish local dates (Europe/Dublin). The brand stays navy and gold
// all year; a season only adds effects (falling pieces, a hat on the logo, a banner).
//
// Only Christmas has artwork so far. The other seasons are defined (so the calendar is agreed in one place) but are switched off until their artwork exists.

export type Particle = "snow" | "hearts" | "shamrocks" | "eggs" | "sun" | "leaves" | "cobwebs";

export interface Season {
  key: "christmas" | "valentines" | "stpatricks" | "easter" | "summer" | "autumn" | "halloween";
  label: string;
  particle: Particle;
  /** Snow settled along the bottom of the screen (Christmas only). */
  pile: boolean;
  /** A Santa hat on the logo (Christmas only). */
  hat: boolean;
  /** False until the artwork for this season exists. */
  ready: boolean;
}

export interface SeasonNow {
  season: Season | null;
  /** Layered on top of the season for a day or two (New Year: fireworks and a message). */
  overlay: { key: "new-year"; fireworks: boolean; message: string } | null;
  /** The Irish calendar date this was worked out for (YYYY-MM-DD). */
  date: string;
}

const SEASONS: Record<Season["key"], Season> = {
  christmas: { key: "christmas", label: "Christmas", particle: "snow", pile: true, hat: true, ready: true },
  valentines: { key: "valentines", label: "Valentine's", particle: "hearts", pile: false, hat: false, ready: false },
  stpatricks: { key: "stpatricks", label: "St Patrick's", particle: "shamrocks", pile: false, hat: false, ready: false },
  easter: { key: "easter", label: "Easter", particle: "eggs", pile: false, hat: false, ready: false },
  summer: { key: "summer", label: "Summer", particle: "sun", pile: false, hat: false, ready: false },
  autumn: { key: "autumn", label: "Autumn", particle: "leaves", pile: false, hat: false, ready: false },
  halloween: { key: "halloween", label: "Halloween", particle: "cobwebs", pile: false, hat: false, ready: false },
};

/** Easter Sunday for a year (the standard Gregorian computus). */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

const dayOfYear = (y: number, m: number, d: number) => Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86_400_000);

/** The Irish calendar date for an instant. */
export function dublinDate(now: Date = new Date()): { y: number; m: number; d: number; iso: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(now).split("-");
  const [y, m, d] = parts.map(Number);
  return { y, m, d, iso: `${parts[0]}-${parts[1]}-${parts[2]}` };
}

/** Which season a month and day falls in, or null for the plain brand look. Windows follow the owner's calendar. */
export function seasonKeyFor(y: number, m: number, d: number): Season["key"] | null {
  const md = m * 100 + d;
  if (md >= 1201 || md <= 106) return "christmas"; // 1 Dec to 6 Jan
  if (md >= 201 && md <= 214) return "valentines";
  if (md >= 310 && md <= 317) return "stpatricks";
  const e = easterSunday(y);
  const doy = dayOfYear(y, m, d);
  if (Math.abs(doy - dayOfYear(y, e.month, e.day)) <= 7) return "easter"; // a week either side of Easter Sunday
  if (md >= 601 && md <= 731) return "summer";
  if (md >= 901 && md <= 1014) return "autumn";
  if (md >= 1015 && md <= 1031) return "halloween";
  return null;
}

export interface SeasonOptions {
  /** Master switch (SEASONS_ENABLED=false turns every seasonal effect off). */
  enabled?: boolean;
  /** Preview or force one season ("christmas"), regardless of the date. */
  forceKey?: string | null;
}

/** What the site and app should look like right now. Seasons whose artwork isn't ready come back as null (the plain brand look). */
export function currentSeason(now: Date = new Date(), options: SeasonOptions = {}): SeasonNow {
  const { y, m, d, iso } = dublinDate(now);
  if (options.enabled === false) return { season: null, overlay: null, date: iso };
  const forced = options.forceKey && options.forceKey in SEASONS ? (options.forceKey as Season["key"]) : null;
  const key = forced ?? seasonKeyFor(y, m, d);
  const season = key && SEASONS[key].ready ? SEASONS[key] : null;
  const newYear = (m === 1 && (d === 1 || d === 2)) || options.forceKey === "new-year";
  const overlay = season?.key === "christmas" && newYear ? ({ key: "new-year", fireworks: true, message: "Happy New Year from S&C Performance Coaching" } as const) : null;
  return { season, overlay, date: iso };
}
