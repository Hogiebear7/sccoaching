"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  DRINK_SETTINGS_STORAGE_KEY,
  parseDrinkSettingsJson,
  type DrinkSettings,
} from "@/lib/drink-settings";

import {
  buildDrinkMix,
  buildDrinkPlan,
  drinkDurationInfo,
  drinkWorkload,
  EXERTION_LABEL,
  fuelBandForLoad,
  macroTargets,
  RUN_EFFORTS,
  sodiumTargetPerLitre,
  SPORT_DATA,
  weightedThreeDayLoad,
  type Exertion,
  type RunEffort,
  type SportId,
  type SweatProfile,
  type TempProfile,
  type WeightGoalBias,
} from "@/lib/nutrition";
import { classifyLoad, LOAD_BAND_LABEL } from "@/lib/workout-helper";
import { PageHeader } from "@/components/ui/PageHeader";

const EXERTION_OPTIONS: Exertion[] = ["low", "medium", "high", "match"];
const BOTTLE_OPTIONS = [500, 750, 1000] as const;
const RUN_PRESETS = [
  { label: "3k", km: 3 },
  { label: "5k", km: 5 },
  { label: "10k", km: 10 },
  { label: "15k", km: 15 },
  { label: "Half marathon", km: 21.1 },
  { label: "Marathon", km: 42.2 },
] as const;
const SPORT_OPTIONS = Object.keys(SPORT_DATA) as SportId[];
const RUN_EFFORT_OPTIONS = Object.keys(RUN_EFFORTS) as RunEffort[];
const SWEAT_OPTIONS: { value: SweatProfile; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
const TEMP_OPTIONS: { value: TempProfile; label: string }[] = [
  { value: "cool", label: "Cool" },
  { value: "warm", label: "Warm" },
  { value: "hot", label: "Hot" },
];

// Selected-state hints shown under the sweat/conditions controls.
const SWEAT_HINT: Record<SweatProfile, string> = {
  low: "Little residue on kit, rarely cramps.",
  medium: "Some white marks on kit after hard sessions.",
  high: "White crust on kit, sweat stings eyes, cramp-prone late on.",
};
const TEMP_HINT: Record<TempProfile, string> = {
  cool: "Under 18°C — little extra fluid loss.",
  warm: "18–25°C — noticeably higher sweat rate.",
  hot: "Over 25°C — fluid and sodium losses climb sharply.",
};

const INGREDIENT_BENEFITS: { name: string; tag: string; summary: string; detail: string }[] = [
  {
    name: "Maltodextrin",
    tag: "Energy",
    summary: "Fast carbohydrate to fuel long, intense sessions.",
    detail:
      "Sports drinks are commonly built around 4–8 g of carbohydrate per 100 ml — roughly 60 g per litre for isotonic use — because concentration matters for both fuel delivery and fluid absorption. Maltodextrin digests quickly with a mild taste, which is why it's the base carbohydrate here.",
  },
  {
    name: "Beta-alanine",
    tag: "Buffering",
    summary: "Supports repeated hard efforts by helping buffer acidity.",
    detail:
      "Included as part of the recipe ratio, though the biggest benefit comes from regular daily use over weeks rather than only on game day. A mild skin tingle at higher doses is normal and harmless.",
  },
  {
    name: "Chia seeds",
    tag: "Texture",
    summary: "Adds a slow-gel texture and a little fibre and fat.",
    detail:
      "Soaked chia adds body without much flavour. The amount stays modest so the drink is easy to tolerate and quick to get down during short breaks.",
  },
  {
    name: "Beetroot powder",
    tag: "Nitrate",
    summary: "Dietary nitrate may support exercise efficiency.",
    detail:
      "Dietary nitrate can modestly reduce the oxygen cost of exercise. The dose is adjusted to your role or run distance first, then scaled with bottle size so concentration stays stable.",
  },
  {
    name: "Orange concentrate",
    tag: "Flavour",
    summary: "Makes the drink more palatable, plus a little fructose.",
    detail:
      "Better-tasting drinks get finished, and sodium works with flavour to stimulate thirst. The small fructose contribution also pairs with maltodextrin for carbohydrate uptake.",
  },
  {
    name: "Salt",
    tag: "Electrolyte",
    summary: "Replaces sweat sodium, drives thirst, and helps retain fluid.",
    detail:
      "A practical in-drink sodium target is 400–1100 mg per litre depending on sweat loss and conditions — higher for salty sweaters and hot sessions. Your dose comes from the sweat and conditions settings above.",
  },
];

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`h-3.5 w-3.5 flex-shrink-0 text-zinc-500 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function fuelChipClass(day: string): string {
  if (day === "match") return "border-gold/30 bg-gold/[0.08] text-gold";
  if (day === "full") return "border-teal-500/25 bg-teal-500/[0.08] text-teal-300";
  if (day === "reduced") return "border-amber-500/25 bg-amber-500/[0.08] text-amber-300";
  return "border-white/[0.1] bg-white/[0.04] text-zinc-300";
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  format,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format: (v: T) => string;
}) {
  return (
    <div className={`grid gap-0.5 rounded-lg border border-white/[0.09] bg-white/[0.03] p-0.5`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
      {options.map((opt) => (
        <button
          key={String(opt)}
          type="button"
          onClick={() => onChange(opt)}
          aria-pressed={value === opt}
          className={`rounded-lg px-1 py-2 text-xs font-medium tabular-nums transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
            value === opt
              ? "bg-white/[0.08] text-zinc-50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07)]"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {format(opt)}
        </button>
      ))}
    </div>
  );
}

export function NutritionView({
  bodyWeightKg,
  goalBias,
  primaryGoal,
  yesterdayExertion,
  todayExertion,
  readinessScore,
  sevenDayLoad,
  daysWithLoad,
  lastSessionTitle,
  lastSessionDate,
  initialDrinkSettings = null,
}: {
  bodyWeightKg: number | null;
  goalBias: WeightGoalBias;
  primaryGoal: string;
  yesterdayExertion: Exertion;
  todayExertion: Exertion;
  readinessScore: number | null;
  sevenDayLoad: number;
  daysWithLoad: number;
  lastSessionTitle: string | null;
  lastSessionDate: string | null;
  initialDrinkSettings?: DrinkSettings | null;
}) {
  const [tomorrow, setTomorrow] = useState<Exertion>("medium");
  const [bottleMl, setBottleMl] = useState<(typeof BOTTLE_OPTIONS)[number]>(1000);
  const [sport, setSport] = useState<SportId>("soccer");
  const [role, setRole] = useState<string>(SPORT_DATA.soccer.defaultRole);
  const [durationIdx, setDurationIdx] = useState(SPORT_DATA.soccer.defaultDurationIdx);
  const [runKm, setRunKm] = useState(10);
  // The distance field is text-first so members can type freely (7.5, 21.1);
  // runKm only updates when the text parses, and normalises on blur.
  const [runKmText, setRunKmText] = useState("10");
  const [runEffort, setRunEffort] = useState<RunEffort>("steady");
  const [sweat, setSweat] = useState<SweatProfile>("medium");
  const [temp, setTemp] = useState<TempProfile>("cool");
  const [benefitsOpen, setBenefitsOpen] = useState(false);
  const [openBenefit, setOpenBenefit] = useState<string | null>(null);

  // Persist calculator settings across visits. Restoring in an effect (not
  // the state initialisers) keeps the first client render identical to the
  // server render — no hydration mismatch; storage is the external system
  // being synced here, so the one-time setState cascade is intentional.
  // Profile-stored settings (synced from any device) win over this device's
  // localStorage; the two are written together on every change.
  const skipFirstSave = useRef(true);
  const serverSettingsRef = useRef(initialDrinkSettings);
  // Latest settings change the debounce hasn't synced yet (see pagehide flush).
  const unsyncedSettingsRef = useRef<DrinkSettings | null>(null);
  useEffect(() => {
    const fromServer = serverSettingsRef.current;
    const saved =
      fromServer ??
      parseDrinkSettingsJson(window.localStorage.getItem(DRINK_SETTINGS_STORAGE_KEY));
    if (!saved) return;
    if (fromServer) {
      // Align this device's copy so the chat chip reflects the synced state.
      try {
        window.localStorage.setItem(DRINK_SETTINGS_STORAGE_KEY, JSON.stringify(fromServer));
      } catch {
        // Best-effort.
      }
    }
    setSport(saved.sport);
    setRole(saved.role);
    setDurationIdx(saved.durationIdx);
    setRunKm(saved.runKm);
    setRunKmText(String(saved.runKm));
    setRunEffort(saved.runEffort);
    if (saved.bottleMl === 500 || saved.bottleMl === 750 || saved.bottleMl === 1000) {
      setBottleMl(saved.bottleMl);
    }
    setSweat(saved.sweat);
    setTemp(saved.temp);
  }, []);

  useEffect(() => {
    // The mount run still holds default state (any restore lands on the next
    // render), so writing here would clobber saved settings — skip it.
    if (skipFirstSave.current) {
      skipFirstSave.current = false;
      return;
    }
    const settings: DrinkSettings = { sport, role, durationIdx, runKm, runEffort, bottleMl, sweat, temp };
    try {
      window.localStorage.setItem(DRINK_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage full or blocked — persistence is best-effort.
    }
    // Debounced fire-and-forget sync to the profile, so settings follow the
    // member across devices and ground the AI coach server-side. Anything
    // still pending when the page hides is flushed via sendBeacon below.
    unsyncedSettingsRef.current = settings;
    const timer = window.setTimeout(() => {
      unsyncedSettingsRef.current = null;
      void fetch("/api/profile/drink-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
        keepalive: true,
      }).catch(() => {
        // Offline or server hiccup — localStorage still has the settings.
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [sport, role, durationIdx, runKm, runEffort, bottleMl, sweat, temp]);

  // Flush a change made just before leaving (tab close, navigation) that the
  // debounce hasn't sent yet. sendBeacon survives page teardown.
  useEffect(() => {
    const flush = () => {
      const pending = unsyncedSettingsRef.current;
      if (!pending) return;
      unsyncedSettingsRef.current = null;
      try {
        navigator.sendBeacon(
          "/api/profile/drink-settings",
          new Blob([JSON.stringify(pending)], { type: "application/json" })
        );
      } catch {
        // Best-effort — localStorage still has the settings.
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  const weight = bodyWeightKg ?? 75;

  const load = weightedThreeDayLoad(yesterdayExertion, todayExertion, tomorrow);
  const band = fuelBandForLoad(load);
  const macros = macroTargets(weight, band, goalBias);
  const weekBand = classifyLoad(sevenDayLoad, daysWithLoad);

  const sportCfg = SPORT_DATA[sport];

  function handleSportChange(next: SportId) {
    setSport(next);
    setRole(SPORT_DATA[next].defaultRole);
    setDurationIdx(SPORT_DATA[next].defaultDurationIdx);
  }

  const drinkInput = useMemo(
    () => ({ bodyWeightKg: weight, bottleMl, sweat, temp, sport, role, durationIdx, runKm, runEffort }),
    [weight, bottleMl, sweat, temp, sport, role, durationIdx, runKm, runEffort]
  );
  const drink = useMemo(() => buildDrinkMix(drinkInput), [drinkInput]);
  const workload = drinkWorkload(drinkInput);
  const durationInfo = drinkDurationInfo(drinkInput);
  const plan = useMemo(() => buildDrinkPlan(drinkInput), [drinkInput]);

  const clampKm = (v: number) => Math.min(50, Math.max(1, v));

  function handleRunKmText(raw: string) {
    setRunKmText(raw);
    const parsed = Number(raw.replace(",", "."));
    if (raw.trim() !== "" && Number.isFinite(parsed) && parsed > 0) {
      setRunKm(clampKm(Math.round(parsed * 10) / 10));
    }
  }

  function handleRunKmBlur() {
    setRunKmText(String(runKm));
  }

  function applyRunPreset(km: number) {
    setRunKm(km);
    setRunKmText(String(km));
  }

  // Readiness-aware hydration line (Recovery data → messaging).
  const hydrationLine =
    readinessScore === null
      ? "No recovery log today — log it in the Recovery tab so fuelling and hydration guidance can react to how you're actually recovering."
      : readinessScore < 50
      ? `Readiness is ${readinessScore} — prioritise fluids and add electrolytes with meals today; low readiness often tracks with poor hydration and sleep.`
      : readinessScore < 75
      ? `Readiness is ${readinessScore} — steady fluids through the day; front-load them earlier rather than catching up tonight.`
      : `Readiness is ${readinessScore} — recovery looks good; normal fluid rhythm with meals and training covers today.`;

  // Workout data → fuelling emphasis.
  const trainingLine =
    weekBand === "high"
      ? `Your 7-day load is ${LOAD_BAND_LABEL[weekBand].toLowerCase()} — protect carbs around sessions and don't train fasted this week.`
      : lastSessionTitle
      ? `Last logged session: ${lastSessionTitle}${lastSessionDate ? ` (${lastSessionDate})` : ""}. Time most of today's carbs before and after training windows.`
      : "No workouts logged yet — once sessions are in the Workouts tab, fuelling emphasis follows your real training.";

  const aiPrompt = `Give me food ideas for a ${band.label.toLowerCase()} (${macros.carbGramsDay} g carbs, ${macros.proteinGramsDay} g protein, ${macros.fatGramsDay} g fat). Use my dietary requirements from my profile and keep it practical around my training.`;

  // Drink handoff prompt: lead with whatever is most likely on the member's
  // mind given their current settings. The chat attaches the full settings
  // itself, so the prompt only needs to point the question.
  const drinkAiPrompt =
    drink.sodiumBadge === "high"
      ? "Why is my drink's sodium this high, and is that okay?"
      : temp === "hot"
      ? "What should I change about my drink plan for hot conditions?"
      : sportCfg.runMode
      ? "Explain my run drink plan — the salt dose, what to carry, and when to drink."
      : "Explain my drink plan — the salt dose, bottle size, and timing.";

  return (
    <section className="anim-rise space-y-8">
      <PageHeader
        eyebrow="Fuelling"
        title="Nutrition"
        subtitle="Daily targets and sports performance hydration, tuned to your training."
      />

      {/* Fuel day hero */}
      <div className="panel relative overflow-hidden p-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(70%_100%_at_25%_0%,rgba(45,212,191,0.07),transparent)]" />
        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-[11px] font-semibold ${fuelChipClass(band.day)}`}>
              {band.label}
            </span>
            <span className="text-xs text-zinc-500 tabular-nums">Weighted 3-day load {load.toFixed(2)}</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-zinc-300">{band.emphasis}</p>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="well px-2 py-2.5">
              <p className="label-caps text-[9px]">Yesterday</p>
              <p className="mt-1 text-[13px] font-semibold text-zinc-200">{EXERTION_LABEL[yesterdayExertion]}</p>
              <p className="mt-0.5 text-[10px] text-zinc-600">from your logs</p>
            </div>
            <div className="well px-2 py-2.5">
              <p className="label-caps text-[9px]">Today</p>
              <p className="mt-1 text-[13px] font-semibold text-zinc-200">{EXERTION_LABEL[todayExertion]}</p>
              <p className="mt-0.5 text-[10px] text-zinc-600">from your logs</p>
            </div>
            <div className="well px-2 py-2.5">
              <p className="label-caps text-[9px]">Tomorrow</p>
              <p className="mt-1 text-[13px] font-semibold text-teal-300">{EXERTION_LABEL[tomorrow]}</p>
              <p className="mt-0.5 text-[10px] text-zinc-600">your plan ↓</p>
            </div>
          </div>

          <div className="mt-3">
            <p className="label-caps mb-2 text-[10px]">Tomorrow&apos;s planned session</p>
            <Segmented
              options={EXERTION_OPTIONS}
              value={tomorrow}
              onChange={setTomorrow}
              format={(v) => EXERTION_LABEL[v]}
            />
          </div>
        </div>
      </div>

      {/* Macro targets */}
      <div>
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="label-caps">Daily Targets</h2>
          <span className="text-xs text-zinc-500 tabular-nums">
            {bodyWeightKg !== null ? `at ${weight} kg` : "using 75 kg — add your weight in Profile"}
          </span>
        </div>
        <div className="panel grid grid-cols-3 divide-x divide-white/[0.06]">
          <div className="px-3 py-4 text-center sm:px-4">
            <p className="label-caps text-[9px] sm:text-[10px]">Carbs</p>
            <p className="text-display mt-2 text-[26px] leading-none text-teal-300 tabular-nums">{macros.carbGramsDay}<span className="text-sm text-zinc-500"> g</span></p>
            <p className="mt-1.5 text-[11px] text-zinc-500 tabular-nums">{macros.carbGkg.toFixed(1)} g/kg</p>
          </div>
          <div className="px-3 py-4 text-center sm:px-4">
            <p className="label-caps text-[9px] sm:text-[10px]">Protein</p>
            <p className="text-display mt-2 text-[26px] leading-none text-zinc-50 tabular-nums">{macros.proteinGramsDay}<span className="text-sm text-zinc-500"> g</span></p>
            <p className="mt-1.5 text-[11px] text-zinc-500 tabular-nums">{macros.proteinGkg.toFixed(1)} g/kg</p>
          </div>
          <div className="px-3 py-4 text-center sm:px-4">
            <p className="label-caps text-[9px] sm:text-[10px]">Fat</p>
            <p className="text-display mt-2 text-[26px] leading-none text-zinc-50 tabular-nums">{macros.fatGramsDay}<span className="text-sm text-zinc-500"> g</span></p>
            <p className="mt-1.5 text-[11px] text-zinc-500 tabular-nums">{macros.fatGkg.toFixed(1)} g/kg</p>
          </div>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-zinc-600">
          Carbs move with your training load{goalBias !== "maintain" ? ` (adjusted for your ${primaryGoal.toLowerCase()} goal)` : ""}; protein and fats stay steady.
        </p>
      </div>

      {/* Guidance — recovery & training linked */}
      <div>
        <h2 className="label-caps mb-2.5">Today&apos;s Emphasis</h2>
        <div className="panel divide-y divide-white/[0.05] overflow-hidden">
          <div className="flex gap-3 px-5 py-4">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-teal-500/20 bg-teal-500/10">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4 text-teal-300">
                <path d="M12 3c-4 4.5-7 8.2-7 11.5A7 7 0 0 0 12 21a7 7 0 0 0 7-6.5C19 11.2 16 7.5 12 3z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight text-zinc-100">Hydration</p>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">{hydrationLine}</p>
            </div>
          </div>
          <div className="flex gap-3 px-5 py-4">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.05]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4 text-gold">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight text-zinc-100">Training fuel</p>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">{trainingLine}</p>
            </div>
          </div>
          <div className="flex gap-3 px-5 py-4">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4 text-violet-300">
                <path d="M12 21C7 17 4 13.5 4 10a8 8 0 0 1 16 0c0 3.5-3 7-8 11z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight text-zinc-100">Micros &amp; recovery</p>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">
                Spread protein across 3–4 meals, get colour on every plate for micronutrients, and
                keep the last big meal 2–3 hours before sleep. Repair happens between sessions, not
                during them.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* AI handoff — optional follow-up, not the core screen */}
      <Link
        href={`/dashboard/messages?prompt=${encodeURIComponent(aiPrompt)}`}
        className="panel hover-lift flex items-center gap-4 p-4"
      >
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-teal-500/25 bg-teal-500/10">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5 text-teal-300">
            <path d="M12 3a7 7 0 0 0-7 7c0 2.1.93 4.09 2.54 5.43V19a2 2 0 0 0 2 2h4.92a2 2 0 0 0 2-2v-3.57A7 7 0 0 0 19 10a7 7 0 0 0-7-7z" />
            <path d="M9.5 21h5" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight text-zinc-100">Learn more with AI Coach</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Food ideas for today&apos;s targets, your dietary needs, and session demand.
          </p>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 flex-shrink-0 text-zinc-600">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </Link>

      {/* Sports performance drink */}
      <div>
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="label-caps">Sports Performance Drink</h2>
          <span className="text-xs text-zinc-500 tabular-nums">{workload.dist} {sportCfg.runMode ? "planned" : "typical"}</span>
        </div>
        <div className="panel overflow-hidden">
          <div className="space-y-4 border-b border-white/[0.06] p-5">
            <div>
              <p className="label-caps mb-2 text-[10px]">Sport</p>
              <select
                value={sport}
                onChange={(e) => handleSportChange(e.target.value as SportId)}
                className="input-field"
              >
                {SPORT_OPTIONS.map((key) => (
                  <option key={key} value={key}>
                    {SPORT_DATA[key].label}
                  </option>
                ))}
              </select>
            </div>

            {sportCfg.runMode ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="label-caps mb-2 text-[10px]">Distance (km)</p>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={runKmText}
                      onChange={(e) => handleRunKmText(e.target.value)}
                      onBlur={handleRunKmBlur}
                      placeholder="e.g. 7.5"
                      aria-label="Run distance in kilometres"
                      className="input-field tabular-nums"
                    />
                  </div>
                  <div>
                    <p className="label-caps mb-2 text-[10px]">Effort</p>
                    <Segmented
                      options={RUN_EFFORT_OPTIONS}
                      value={runEffort}
                      onChange={setRunEffort}
                      format={(v) => RUN_EFFORTS[v].label}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {RUN_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => applyRunPreset(preset.km)}
                      aria-pressed={runKm === preset.km}
                      className={`rounded-md border px-3 py-1.5 text-[11px] font-medium tabular-nums transition-[background-color,color,border-color] duration-150 active:scale-[0.97] ${
                        runKm === preset.km
                          ? "border-teal-500/40 bg-teal-500/[0.12] text-teal-300"
                          : "border-white/[0.1] bg-white/[0.04] text-zinc-400 hover:border-white/[0.14] hover:text-zinc-200"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <p className="label-caps mb-2 text-[10px]">{sportCfg.roleLabel}</p>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="input-field"
                >
                  {Object.entries(sportCfg.roles).map(([key, r]) => (
                    <option key={key} value={key}>
                      {r.label} · {r.dist}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-zinc-600">{workload.desc}</p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="label-caps mb-2 text-[10px]">Bottle</p>
                <Segmented options={BOTTLE_OPTIONS} value={bottleMl} onChange={setBottleMl} format={(v) => `${v} ml`} />
              </div>
              <div>
                <p className="label-caps mb-2 text-[10px]">{sportCfg.runMode ? "Run duration" : "Session length"}</p>
                {sportCfg.runMode ? (
                  <div className="rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-center">
                    <p className="text-sm font-semibold text-zinc-100 tabular-nums">≈ {durationInfo.mins} min</p>
                    <p className="text-[10px] text-zinc-600">from distance & effort</p>
                  </div>
                ) : (
                  <Segmented
                    options={sportCfg.durations.map((_, i) => i)}
                    value={durationIdx}
                    onChange={setDurationIdx}
                    format={(i) => sportCfg.durations[i].short}
                  />
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="label-caps mb-2 text-[10px]">Sweat rate</p>
                <Segmented options={SWEAT_OPTIONS.map((o) => o.value)} value={sweat} onChange={setSweat} format={(v) => SWEAT_OPTIONS.find((o) => o.value === v)!.label} />
                <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-600">{SWEAT_HINT[sweat]}</p>
              </div>
              <div>
                <p className="label-caps mb-2 text-[10px]">Conditions</p>
                <Segmented options={TEMP_OPTIONS.map((o) => o.value)} value={temp} onChange={setTemp} format={(v) => TEMP_OPTIONS.find((o) => o.value === v)!.label} />
                <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-600">{TEMP_HINT[temp]}</p>
              </div>
            </div>

            <div className="well px-4 py-3">
              <p className="text-xs leading-relaxed text-zinc-400">
                <span className="font-semibold text-zinc-200">Why these settings matter:</span>{" "}
                saltier sweat means more sodium lost per litre — light sweaters do well near
                300–500 mg/L, salty sweaters near 600–900 mg/L. Heat and longer sessions raise both
                fluid and sodium loss, so the same athlete needs a stronger mix on a hot day. These
                settings move the <span className="font-medium text-zinc-200">salt</span> line only;
                carbs are set by your body weight.
              </p>
              <p className="mt-2 text-xs text-zinc-400">
                Current target:{" "}
                <span className="font-semibold text-teal-300 tabular-nums">
                  ~{sodiumTargetPerLitre(sweat, temp)} mg sodium per litre
                </span>
                {temp === "hot" ? " — in the heat, add extra plain water alongside this bottle rather than making the mix stronger." : "."}
              </p>
            </div>

            <p className="text-[11px] text-zinc-600 tabular-nums">
              Mixed for {weight} kg{bodyWeightKg === null ? " (default — set your weight in Profile)" : ""} · {bottleMl} ml bottle
            </p>
          </div>

          {/* Ingredients */}
          <div className="divide-y divide-white/[0.04]">
            {[
              { name: "Maltodextrin", amount: `${drink.maltodextrinG} g` },
              { name: "Beta-alanine", amount: `${drink.betaAlanineG} g` },
              { name: "Chia seeds", amount: `${drink.chiaG} g` },
              { name: "Beetroot powder", amount: `${drink.beetrootG} g` },
              { name: "Orange concentrate", amount: `${drink.orangeMl} ml` },
              { name: "Salt", amount: `${drink.saltG.toFixed(2)} g` },
              { name: "Water", amount: `top up to ${bottleMl} ml` },
            ].map((row) => (
              <div key={row.name} className="flex items-center justify-between px-5 py-2.5">
                <p className="text-[13px] text-zinc-300">{row.name}</p>
                <p className="text-[13px] font-semibold text-zinc-100 tabular-nums">{row.amount}</p>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="grid grid-cols-4 divide-x divide-white/[0.06] border-t border-white/[0.06] bg-white/[0.015]">
            {[
              { label: "Carbs", value: `${drink.carbsG.toFixed(0)} g`, tone: "text-teal-300" },
              { label: "Sodium", value: `${drink.sodiumTotalMg} mg`, tone: "text-zinc-50" },
              { label: "Nitrate", value: `${drink.nitrateMg} mg`, tone: "text-zinc-50" },
              { label: "Energy", value: `${drink.calories} kcal`, tone: "text-zinc-50" },
            ].map((cell) => (
              <div key={cell.label} className="px-2 py-3 text-center">
                <p className="label-caps text-[9px]">{cell.label}</p>
                <p className={`text-display mt-1 text-[15px] tabular-nums ${cell.tone}`}>{cell.value}</p>
              </div>
            ))}
          </div>

          {/* Sodium badge + timing */}
          <div className="border-t border-white/[0.06] p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium ${
                  drink.sodiumBadge === "optimal"
                    ? "border-teal-500/25 bg-teal-500/[0.08] text-teal-300"
                    : drink.sodiumBadge === "high"
                    ? "border-amber-500/25 bg-amber-500/[0.08] text-amber-300"
                    : "border-white/[0.1] bg-white/[0.04] text-zinc-400"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${drink.sodiumBadge === "optimal" ? "bg-teal-400" : drink.sodiumBadge === "high" ? "bg-amber-400" : "bg-zinc-500"}`} />
                {drink.sodiumBadge === "optimal"
                  ? "Optimal hydration range"
                  : drink.sodiumBadge === "high"
                  ? "High-sodium profile"
                  : "Below recommended range"}
              </span>
            </div>

            <p className="label-caps mb-2 mt-4 text-[10px]">Drinking plan</p>
            <p className="mb-2.5 text-xs leading-relaxed text-zinc-400">
              <span className="font-medium text-zinc-200">{sportCfg.runMode ? "Carry: " : "Bottle: "}</span>
              {plan.bottleAdvice}
            </p>
            <div className={`grid gap-2 text-center ${plan.phases.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
              {plan.phases.map((cell) => (
                <div key={cell.label} className="well px-2 py-2.5">
                  <p className="label-caps text-[9px]">{cell.label}</p>
                  <p className="text-display mt-1 text-[15px] text-zinc-100 tabular-nums">{cell.amount}</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-600">{cell.tip}</p>
                </div>
              ))}
            </div>
            {plan.extra ? (
              <p className="mt-2.5 text-xs leading-relaxed text-amber-300/90">{plan.extra}</p>
            ) : null}

            <Link
              href={`/dashboard/messages?prompt=${encodeURIComponent(drinkAiPrompt)}`}
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-400 transition-colors duration-150 hover:text-blue-300"
            >
              Ask the AI Coach about this plan
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3 w-3">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </Link>
          </div>

          {/* Ingredient benefits — collapsible */}
          <div className="border-t border-white/[0.06]">
            <button
              type="button"
              onClick={() => setBenefitsOpen((o) => !o)}
              aria-expanded={benefitsOpen}
              aria-controls="ingredient-benefits"
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-[background-color,transform] duration-150 hover:bg-white/[0.02] active:scale-[0.995]"
            >
              <span>
                <span className="block text-sm font-semibold tracking-tight text-zinc-100">Ingredient benefits</span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  What each ingredient does and why it&apos;s in your bottle
                </span>
              </span>
              <Chevron open={benefitsOpen} />
            </button>
            {benefitsOpen ? (
              <div id="ingredient-benefits" className="space-y-2 px-5 pb-5">
                {INGREDIENT_BENEFITS.map((item) => {
                  const open = openBenefit === item.name;
                  const detailId = `benefit-${item.name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
                  return (
                    <div key={item.name} className="rounded-lg border border-white/[0.08] bg-white/[0.03]">
                      <button
                        type="button"
                        onClick={() => setOpenBenefit(open ? null : item.name)}
                        aria-expanded={open}
                        aria-controls={detailId}
                        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-[background-color,transform] duration-150 hover:bg-white/[0.02] active:scale-[0.995]"
                      >
                        <span>
                          <span className="text-[13px] font-semibold text-zinc-100">{item.name}</span>
                          <span
                            className={`ml-2 rounded-md border px-2 py-0.5 align-middle text-[10px] font-medium ${
                              item.tag === "Electrolyte"
                                ? "border-gold/30 bg-gold/[0.08] text-gold"
                                : "border-teal-500/25 bg-teal-500/[0.08] text-teal-300"
                            }`}
                          >
                            {item.tag}
                          </span>
                          <span className="mt-1 block text-xs leading-relaxed text-zinc-500">{item.summary}</span>
                        </span>
                        <span className="mt-1"><Chevron open={open} /></span>
                      </button>
                      {open ? (
                        <p id={detailId} className="px-4 pb-3.5 text-xs leading-relaxed text-zinc-400">
                          {item.detail}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-zinc-600">
          Guidance for healthy adult athletes — not medical or dietetic advice. Trial the mix in
          training before using it on match or race day.
        </p>
      </div>
    </section>
  );
}
