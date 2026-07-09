// Persisted Sports Performance Drink calculator settings.
//
// Client-safe and pure. The Nutrition tab saves these to localStorage so the
// calculator doesn't reset between visits, and the AI chat sends them along
// so the coach can explain the member's actual mix ("why this much salt?").
// Everything read from storage or a request body goes through
// normalizeDrinkSettings, which coerces every field to a known-good value —
// so downstream code never sees an invalid sport, role, or range.

import {
  RUN_EFFORTS,
  SPORT_DATA,
  type RunEffort,
  type SportId,
  type SweatProfile,
  type TempProfile,
} from "./nutrition";

export const DRINK_SETTINGS_STORAGE_KEY = "sc-drink-settings-v1";

export interface DrinkSettings {
  sport: SportId;
  role: string;
  durationIdx: number;
  runKm: number;
  runEffort: RunEffort;
  bottleMl: number;
  sweat: SweatProfile;
  temp: TempProfile;
}

export const DEFAULT_DRINK_SETTINGS: DrinkSettings = {
  sport: "soccer",
  role: SPORT_DATA.soccer.defaultRole,
  durationIdx: SPORT_DATA.soccer.defaultDurationIdx,
  runKm: 10,
  runEffort: "steady",
  bottleMl: 1000,
  sweat: "medium",
  temp: "cool",
};

const BOTTLE_SIZES = [500, 750, 1000];
const SWEAT_VALUES: SweatProfile[] = ["low", "medium", "high"];
const TEMP_VALUES: TempProfile[] = ["cool", "warm", "hot"];

// Coerce untrusted data (localStorage, request body) to valid settings.
// Field-by-field: anything unrecognised falls back to the default, and role/
// duration are validated against the resolved sport so they always agree.
export function normalizeDrinkSettings(raw: unknown): DrinkSettings {
  const d = DEFAULT_DRINK_SETTINGS;
  if (typeof raw !== "object" || raw === null) return { ...d };
  const r = raw as Record<string, unknown>;

  const sport =
    typeof r.sport === "string" && r.sport in SPORT_DATA ? (r.sport as SportId) : d.sport;
  const cfg = SPORT_DATA[sport];

  const role =
    typeof r.role === "string" && r.role in cfg.roles ? r.role : cfg.defaultRole;

  const durationIdx =
    typeof r.durationIdx === "number" &&
    Number.isInteger(r.durationIdx) &&
    r.durationIdx >= 0 &&
    r.durationIdx < cfg.durations.length
      ? r.durationIdx
      : cfg.defaultDurationIdx;

  const runKm =
    typeof r.runKm === "number" && Number.isFinite(r.runKm) && r.runKm >= 1 && r.runKm <= 50
      ? Math.round(r.runKm * 10) / 10
      : d.runKm;

  const runEffort =
    typeof r.runEffort === "string" && r.runEffort in RUN_EFFORTS
      ? (r.runEffort as RunEffort)
      : d.runEffort;

  const bottleMl =
    typeof r.bottleMl === "number" && BOTTLE_SIZES.includes(r.bottleMl) ? r.bottleMl : d.bottleMl;

  const sweat = SWEAT_VALUES.includes(r.sweat as SweatProfile)
    ? (r.sweat as SweatProfile)
    : d.sweat;
  const temp = TEMP_VALUES.includes(r.temp as TempProfile) ? (r.temp as TempProfile) : d.temp;

  return { sport, role, durationIdx, runKm, runEffort, bottleMl, sweat, temp };
}

// Compact chip label for the chat UI, e.g. "Rugby · 750 ml" or
// "Run · 21.1 km · Hot". Conditions only appear when they're notable
// (warm/hot), since that's when they visibly shape the mix.
export function describeDrinkSettings(s: DrinkSettings): string {
  const cfg = SPORT_DATA[s.sport];
  const parts = cfg.runMode
    ? [cfg.label, `${s.runKm} km`]
    : [cfg.label, `${s.bottleMl} ml`];
  if (s.temp === "hot") parts.push("Hot");
  else if (s.temp === "warm") parts.push("Warm");
  return parts.join(" · ");
}

// Parse a stored JSON string. Returns null when nothing valid was stored
// (caller keeps its defaults and avoids an unnecessary state update).
export function parseDrinkSettingsJson(json: string | null): DrinkSettings | null {
  if (!json) return null;
  try {
    const raw: unknown = JSON.parse(json);
    if (typeof raw !== "object" || raw === null) return null;
    return normalizeDrinkSettings(raw);
  } catch {
    return null;
  }
}
