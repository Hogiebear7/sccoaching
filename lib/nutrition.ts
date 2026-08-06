// Fuelling logic for the Nutrition tab.
//
// Ported from the club's calculator sheets:
//  - player-performance-calculator_final.html  (daily macro targets)
//  - Match Drink Calculator.html               (match-day bottle mix)
//
// Pure and deterministic — inputs come from the member's own records
// (recovery logs, profile) plus a couple of explicit selections.

// ─── Day exertion & weighted 3-day load ───────────────────────────────

export type Exertion = "low" | "medium" | "high" | "match";

export const EXERTION_SCORE: Record<Exertion, number> = {
  low: 1,
  medium: 2,
  high: 3,
  match: 4,
};

export const EXERTION_LABEL: Record<Exertion, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  match: "Match",
};

// Map a day's logged training load (duration × RPE from the Recovery tab)
// onto the calculator's exertion scale. 0 = rest day.
export function exertionFromDayLoad(dayLoad: number): Exertion {
  if (dayLoad <= 0) return "low";
  if (dayLoad < 300) return "medium"; // e.g. 45 min @ RPE 6
  if (dayLoad < 480) return "high"; // e.g. 60 min @ RPE 8
  return "match";
}

// Weighted 3-day load: today matters most, tomorrow next (fuelling ahead),
// yesterday least. Weights from the calculator sheet.
export function weightedThreeDayLoad(
  yesterday: Exertion,
  today: Exertion,
  tomorrow: Exertion
): number {
  const value =
    EXERTION_SCORE[yesterday] * 0.2 +
    EXERTION_SCORE[today] * 0.5 +
    EXERTION_SCORE[tomorrow] * 0.3;
  return Math.round(value * 100) / 100;
}

// ─── Fuel day bands & macro targets ───────────────────────────────────

export type FuelDay = "reduced" | "standard" | "full" | "match";

export interface FuelBand {
  day: FuelDay;
  label: string;
  carbGkg: number;
  proteinGkg: number;
  fatGkg: number;
  emphasis: string;
}

// Carbs are the variable; protein and fats stay comparatively stable.
export function fuelBandForLoad(load: number): FuelBand {
  if (load <= 1.5) {
    return {
      day: "reduced",
      label: "Reduced fuel day",
      carbGkg: 4,
      proteinGkg: 1.6,
      fatGkg: 0.9,
      emphasis: "Lighter training window — ease carbs back, hold protein steady.",
    };
  }
  if (load <= 2.2) {
    return {
      day: "standard",
      label: "Standard fuel day",
      carbGkg: 5,
      proteinGkg: 1.6,
      fatGkg: 0.8,
      emphasis: "Normal training rhythm — steady carbs around your sessions.",
    };
  }
  if (load <= 3.0) {
    return {
      day: "full",
      label: "Full fuel day",
      carbGkg: 6,
      proteinGkg: 1.8,
      fatGkg: 0.7,
      emphasis: "Heavy training window — carbs are doing the work today.",
    };
  }
  return {
    day: "match",
    label: "Match fuel day",
    carbGkg: 7,
    proteinGkg: 2.0,
    fatGkg: 0.7,
    emphasis: "Match demands — prioritise carbs before, during, and after.",
  };
}

export type WeightGoalBias = "maintain" | "lose" | "gain";

// The app's primaryGoal maps loosely onto the calculator's weight-goal bias.
export function goalBiasFromPrimaryGoal(primaryGoal: string): WeightGoalBias {
  if (primaryGoal === "Weight Loss") return "lose";
  if (primaryGoal === "Build Muscle") return "gain";
  return "maintain";
}

export interface MacroTargets {
  carbGkg: number;
  proteinGkg: number;
  fatGkg: number;
  carbGramsDay: number;
  proteinGramsDay: number;
  fatGramsDay: number;
}

// Carb bias for cut/gain goals — the calculator scales with a target rate
// of change the app doesn't collect, so we apply its capped bias (±0.3).
const GOAL_CARB_BIAS: Record<WeightGoalBias, number> = {
  maintain: 0,
  lose: -0.3,
  gain: 0.3,
};

export function macroTargets(
  bodyWeightKg: number,
  band: FuelBand,
  bias: WeightGoalBias = "maintain"
): MacroTargets {
  const carbGkg = Math.round((band.carbGkg + GOAL_CARB_BIAS[bias]) * 10) / 10;
  return {
    carbGkg,
    proteinGkg: band.proteinGkg,
    fatGkg: band.fatGkg,
    carbGramsDay: Math.round(bodyWeightKg * carbGkg),
    proteinGramsDay: Math.round(bodyWeightKg * band.proteinGkg),
    fatGramsDay: Math.round(bodyWeightKg * band.fatGkg),
  };
}

// ─── Sports performance drink mix ─────────────────────────────────────
//
// Sport-aware: each sport defines role options (workload estimate + beetroot
// dose), duration bands (sodium duration factor anchored to 90 min = 1.0),
// and the copy terms the UI needs. Run mode derives duration from
// distance × effort pace instead of fixed bands.

export type SportId = "soccer" | "gaelic" | "hurling" | "rugby" | "hockey" | "run";
export type SweatProfile = "low" | "medium" | "high";
export type TempProfile = "cool" | "warm" | "hot";
export type RunEffort = "easy" | "steady" | "hard";

// Broad role archetype, purely for picking a consistent icon in the
// position picker — a handful of shared symbols reused across sports
// (goalkeeper/defence/midfield/attack) rather than one bespoke icon per
// named position, which would be dozens of near-identical marks.
export type RoleArchetype = "gk" | "def" | "mid" | "atk";

export interface SportRole {
  label: string;
  dist: string;
  desc: string;
  beet: number;
  archetype: RoleArchetype;
}

export interface SportDuration {
  // Short label for segmented controls; mins shown alongside where useful.
  short: string;
  mins: number;
  factor: number;
}

export interface SportConfig {
  label: string;
  /** Emoji shown beside the sport in the sport picker. */
  icon: string;
  roleLabel: string;
  // Labels for the four drinking-plan phases (team sports only).
  phaseLabels: [string, string, string, string];
  durations: SportDuration[];
  defaultDurationIdx: number;
  roles: Record<string, SportRole>;
  defaultRole: string;
  runMode?: boolean;
}

const MATCH_PHASES: [string, string, string, string] = [
  "Pre-match",
  "First half",
  "Half-time",
  "Second half",
];

export const SPORT_DATA: Record<SportId, SportConfig> = {
  soccer: {
    label: "Soccer",
    icon: "⚽",
    roleLabel: "Position",
    phaseLabels: MATCH_PHASES,
    durations: [
      { short: "60 min", mins: 60, factor: 0.7 },
      { short: "90 min", mins: 90, factor: 1.0 },
      { short: "120 min", mins: 120, factor: 1.3 },
    ],
    defaultDurationIdx: 1,
    defaultRole: "cm",
    roles: {
      gk: { label: "Goalkeeper", dist: "~5–6 km", desc: "Explosive short bursts, minimal continuous running.", beet: 5, archetype: "gk" },
      cb: { label: "Centre Back", dist: "~8–9 km", desc: "Moderate distance, lower sprint frequency.", beet: 5, archetype: "def" },
      fb: { label: "Full Back", dist: "~10–11 km", desc: "High up-and-down running and overlapping support.", beet: 6, archetype: "def" },
      dm: { label: "Defensive Mid", dist: "~10–11 km", desc: "Covering space behind the ball and screening lanes.", beet: 6, archetype: "mid" },
      cm: { label: "Centre Mid", dist: "~10–12 km", desc: "Box-to-box covering with repeated sprints.", beet: 8, archetype: "mid" },
      wm: { label: "Winger", dist: "~11–13 km", desc: "Highest distance role with repeated wide sprints.", beet: 8, archetype: "atk" },
      st: { label: "Striker", dist: "~9–11 km", desc: "Explosive pressing and short sprint actions.", beet: 6, archetype: "atk" },
    },
  },
  gaelic: {
    label: "Gaelic football",
    icon: "🏐",
    roleLabel: "Line / role",
    phaseLabels: MATCH_PHASES,
    durations: [
      { short: "60 min", mins: 60, factor: 0.7 },
      { short: "70 min", mins: 70, factor: 0.8 },
      { short: "90 min", mins: 90, factor: 1.0 },
    ],
    defaultDurationIdx: 1,
    defaultRole: "mid",
    roles: {
      gk: { label: "Goalkeeper", dist: "~2–4 km", desc: "Kick-outs and restarts, low continuous running.", beet: 5, archetype: "gk" },
      back: { label: "Back line", dist: "~7–9 km", desc: "Tracking runners and supporting attacks from deep.", beet: 6, archetype: "def" },
      mid: { label: "Midfield", dist: "~9–11 km", desc: "Kick-out contests plus end-to-end support running.", beet: 8, archetype: "mid" },
      fwd: { label: "Forward line", dist: "~8–10 km", desc: "Repeated hard pressing and sharp movement for possession.", beet: 7, archetype: "atk" },
    },
  },
  hurling: {
    label: "Hurling / Camogie",
    icon: "🥍",
    roleLabel: "Line / role",
    phaseLabels: MATCH_PHASES,
    durations: [
      { short: "60 min", mins: 60, factor: 0.7 },
      { short: "70 min", mins: 70, factor: 0.8 },
      { short: "90 min", mins: 90, factor: 1.0 },
    ],
    defaultDurationIdx: 1,
    defaultRole: "mid",
    roles: {
      gk: { label: "Goalkeeper", dist: "~2–3 km", desc: "Puck-outs and reflex work, minimal running volume.", beet: 5, archetype: "gk" },
      back: { label: "Back line", dist: "~6–8 km", desc: "Contesting deliveries with short explosive duels.", beet: 6, archetype: "def" },
      mid: { label: "Midfield", dist: "~8–10 km", desc: "Link play both ways at sustained high intensity.", beet: 8, archetype: "mid" },
      fwd: { label: "Forward line", dist: "~7–9 km", desc: "Sharp movement, pressing puck-outs, repeated sprints.", beet: 7, archetype: "atk" },
    },
  },
  rugby: {
    label: "Rugby",
    icon: "🏉",
    roleLabel: "Position group",
    phaseLabels: MATCH_PHASES,
    durations: [
      { short: "60 min", mins: 60, factor: 0.7 },
      { short: "80 min", mins: 80, factor: 0.9 },
      { short: "100 min", mins: 100, factor: 1.15 },
    ],
    defaultDurationIdx: 1,
    defaultRole: "backrow",
    roles: {
      tight: { label: "Tight five (1–5)", dist: "~5–6 km", desc: "Scrums, mauls, and repeated collisions — big anaerobic load.", beet: 5, archetype: "def" },
      backrow: { label: "Back row (6–8)", dist: "~6–7 km", desc: "Constant carrying, tackling, and breakdown work.", beet: 6, archetype: "mid" },
      halves: { label: "Half-backs (9–10)", dist: "~7–8 km", desc: "Support lines to every ruck plus game management.", beet: 7, archetype: "mid" },
      centres: { label: "Centres (12–13)", dist: "~6–7 km", desc: "Hard carries and defensive reads with collision sprints.", beet: 6, archetype: "atk" },
      back3: { label: "Back three (11, 14, 15)", dist: "~7–8 km", desc: "High-speed chases, counters, and covering kicks.", beet: 7, archetype: "atk" },
    },
  },
  hockey: {
    label: "Hockey",
    icon: "🏑",
    roleLabel: "Position",
    phaseLabels: ["Pre-match", "Early quarters", "Quarter & half breaks", "Final quarters"],
    durations: [
      { short: "Training", mins: 60, factor: 0.7 },
      { short: "Match 4×15", mins: 60, factor: 0.75 },
      { short: "Extended", mins: 90, factor: 1.0 },
    ],
    defaultDurationIdx: 1,
    defaultRole: "mid",
    roles: {
      gk: { label: "Goalkeeper", dist: "~2–3 km", desc: "Explosive saves in heavy kit — heat builds quickly.", beet: 5, archetype: "gk" },
      def: { label: "Defender", dist: "~7–8 km", desc: "Structured pressing and recovery runs with rolling subs.", beet: 6, archetype: "def" },
      mid: { label: "Midfielder", dist: "~8–9 km", desc: "Two-way running at high intensity between rotations.", beet: 8, archetype: "mid" },
      fwd: { label: "Forward", dist: "~7–9 km", desc: "Repeated sprint pressing in short, intense shifts.", beet: 7, archetype: "atk" },
    },
  },
  run: {
    label: "Run",
    icon: "🏃",
    roleLabel: "Distance",
    phaseLabels: ["Before", "During", "After", ""],
    durations: [],
    defaultDurationIdx: 0,
    defaultRole: "",
    roles: {},
    runMode: true,
  },
};

export const ROLE_ARCHETYPE_ICON: Record<RoleArchetype, string> = {
  gk: "🧤",
  def: "🛡️",
  mid: "⚙️",
  atk: "⚡",
};

export const RUN_EFFORTS: Record<
  RunEffort,
  { label: string; paceMinPerKm: number; desc: string }
> = {
  easy: { label: "Easy", paceMinPerKm: 6.5, desc: "Comfortable, conversational pace — lower sweat and fuel demand." },
  steady: { label: "Steady", paceMinPerKm: 5.5, desc: "Purposeful aerobic pace — moderate, sustained demand." },
  hard: { label: "Hard", paceMinPerKm: 4.75, desc: "Tempo or race effort — highest sweat rate and carb demand." },
};

// Sodium target per litre (mg) by sweat profile × conditions.
const SODIUM_TARGETS: Record<SweatProfile, Record<TempProfile, number>> = {
  low: { cool: 300, warm: 400, hot: 500 },
  medium: { cool: 400, warm: 550, hot: 700 },
  high: { cool: 600, warm: 800, hot: 900 },
};

// Base sodium target per litre for a sweat/conditions pairing (before the
// duration factor is applied) — surfaced in the UI explainer.
export function sodiumTargetPerLitre(sweat: SweatProfile, temp: TempProfile): number {
  return SODIUM_TARGETS[sweat][temp];
}

export interface DrinkInput {
  bodyWeightKg: number;
  bottleMl: number;
  sweat: SweatProfile;
  temp: TempProfile;
  sport: SportId;
  // Team sports: a key of SPORT_DATA[sport].roles + a duration band index.
  role: string;
  durationIdx: number;
  // Run mode: distance + effort derive the duration instead.
  runKm: number;
  runEffort: RunEffort;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// Estimated session minutes + sodium duration factor (90 min = 1.0). Run
// mode derives minutes from distance × pace, clamped so extremes stay
// sensible; team sports use their explicit bands.
export function drinkDurationInfo(input: DrinkInput): { mins: number; factor: number } {
  const cfg = SPORT_DATA[input.sport];
  if (cfg.runMode) {
    const mins = Math.round((input.runKm * RUN_EFFORTS[input.runEffort].paceMinPerKm) / 5) * 5;
    return { mins, factor: clamp(mins / 90, 0.6, 1.8) };
  }
  const opt = cfg.durations[input.durationIdx] ?? cfg.durations[cfg.defaultDurationIdx];
  return { mins: opt.mins, factor: opt.factor };
}

function drinkBeetDose(input: DrinkInput): number {
  const cfg = SPORT_DATA[input.sport];
  if (cfg.runMode) return input.runKm < 8 ? 5 : input.runKm <= 15 ? 6 : 8;
  const role = cfg.roles[input.role] ?? cfg.roles[cfg.defaultRole];
  return role.beet;
}

// Workload line for the UI: role estimate for team sports, the run itself
// for run mode.
export function drinkWorkload(input: DrinkInput): { dist: string; desc: string } {
  const cfg = SPORT_DATA[input.sport];
  if (cfg.runMode) {
    return { dist: `${input.runKm} km`, desc: RUN_EFFORTS[input.runEffort].desc };
  }
  const role = cfg.roles[input.role] ?? cfg.roles[cfg.defaultRole];
  return { dist: role.dist, desc: role.desc };
}

export interface DrinkMix {
  maltodextrinG: number;
  betaAlanineG: number;
  chiaG: number;
  beetrootG: number;
  orangeMl: number;
  saltG: number;
  sodiumFromSaltMg: number;
  sodiumFromOrangeMg: number;
  sodiumTotalMg: number;
  carbsG: number;
  nitrateMg: number;
  calories: number;
  sodiumBadge: "below" | "optimal" | "high";
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function buildDrinkMix(input: DrinkInput): DrinkMix {
  const vf = input.bottleMl / 1000;
  const bw = input.bodyWeightKg;

  const maltodextrinG = round1(bw * 0.4 * vf);
  const betaAlanineBase = bw < 60 ? 1.2 : bw <= 85 ? 1.6 : 2.0;
  const betaAlanineG = round1(betaAlanineBase * vf);
  const chiaG = round1(5 * vf);
  const beetrootG = round1(drinkBeetDose(input) * vf);
  const orangeMl = Math.round(20 * vf);

  const durationFactor = drinkDurationInfo(input).factor;
  const sodiumFromSaltMg =
    Math.round((SODIUM_TARGETS[input.sweat][input.temp] * durationFactor * vf) / 10) * 10;
  const saltG = Math.round((sodiumFromSaltMg / 393) * 100) / 100;
  const sodiumFromOrangeMg = Math.round((8 / 20) * orangeMl);
  const sodiumTotalMg = sodiumFromSaltMg + sodiumFromOrangeMg;

  const carbsG = round1(maltodextrinG * 0.95 + orangeMl * 0.1);
  const nitrateMg = Math.round(beetrootG * 50);
  const calories = Math.round(maltodextrinG * 4 + orangeMl * 0.4);

  const sodiumBadge =
    sodiumTotalMg < 300 ? "below" : sodiumTotalMg <= 900 ? "optimal" : "high";

  return {
    maltodextrinG,
    betaAlanineG,
    chiaG,
    beetrootG,
    orangeMl,
    saltG,
    sodiumFromSaltMg,
    sodiumFromOrangeMg,
    sodiumTotalMg,
    carbsG,
    nitrateMg,
    calories,
    sodiumBadge,
  };
}

// ─── Drinking plan ────────────────────────────────────────────────────
//
// Practical, phase-by-phase drinking guidance built on top of the mix.
// Team sports split the selected bottle across match phases; run mode works
// from an hourly fluid rate (sweat + conditions) applied to the estimated
// duration. Ranges are deliberately broad — sweat rates vary too much for
// single-ml precision to be honest.

export interface DrinkPlanPhase {
  label: string;
  amount: string;
  tip: string;
}

export interface DrinkPlan {
  // "Optimal bottle/carry size" line shown at the top of the plan.
  bottleAdvice: string;
  phases: DrinkPlanPhase[];
  // Long/hot-session note (e.g. second bottle at the same ratio), if any.
  extra: string | null;
}

// Bottle share per match phase: pre 28%, first half 18%, half-time 28%,
// second half 26%. (Evolution of the original 28/18/45 split — the old 45%
// "half-time" share realistically spills into the second half.)
const MATCH_PHASE_SHARE = [0.28, 0.18, 0.28, 0.26] as const;
const MATCH_PHASE_TIPS = [
  "start ~60 min out, most before warm-up",
  "little and often at breaks in play",
  "biggest window — drink deliberately",
  "use stoppages; finish by full-time",
] as const;

const roundTo10 = (v: number) => Math.round(v / 10) * 10;
const roundTo50 = (v: number) => Math.round(v / 50) * 50;

// Approximate in-session fluid need per hour for run mode.
function runFluidRatePerHour(sweat: SweatProfile, temp: TempProfile): number {
  const base = { cool: 500, warm: 650, hot: 800 }[temp];
  const sweatAdj = { low: -100, medium: 0, high: 100 }[sweat];
  return base + sweatAdj;
}

export function buildDrinkPlan(input: DrinkInput): DrinkPlan {
  const cfg = SPORT_DATA[input.sport];
  const { mins } = drinkDurationInfo(input);

  if (!cfg.runMode) {
    const recommendedMl = mins <= 60 ? 750 : 1000;
    const sizeNote =
      input.bottleMl < recommendedMl
        ? ` — you've selected ${input.bottleMl} ml, so top up with plain water at breaks`
        : ` — your ${input.bottleMl} ml bottle covers it`;
    const hotOrLong = input.temp === "hot" || mins >= 100;
    return {
      bottleAdvice: `A ${recommendedMl} ml bottle suits a ${mins}-min session${sizeNote}.`,
      phases: cfg.phaseLabels.map((label, i) => ({
        label,
        amount: `${roundTo10(input.bottleMl * MATCH_PHASE_SHARE[i])} ml`,
        tip: MATCH_PHASE_TIPS[i],
      })),
      extra: hotOrLong
        ? "Long or hot session — bring a second bottle mixed at the same ratio instead of making this one stronger."
        : null,
    };
  }

  // Run mode: fluid need from duration × hourly rate.
  const duringMl = roundTo50(runFluidRatePerHour(input.sweat, input.temp) * (mins / 60));
  const shortRun = mins < 40;
  const sipInterval = input.temp === "hot" ? "10–15" : "15–20";

  const carryAdvice = shortRun
    ? "No carried drink needed for this run — use this bottle before and after."
    : duringMl <= 500
      ? "Carry a small soft flask (250–500 ml)."
      : duringMl <= 900
        ? "Carry 500–750 ml — handheld or running vest."
        : "Use a vest with 1–1.5 L or plan refill points — mix extra bottles at the same ratio.";

  const duringAmount = shortRun
    ? "Optional"
    : `${roundTo50(duringMl * 0.8)}–${roundTo50(duringMl * 1.2)} ml`;
  const duringTip = shortRun
    ? "short run — drinking before and after covers it"
    : `2–3 sips (~100–150 ml) every ${sipInterval} min`;

  return {
    bottleAdvice: carryAdvice,
    phases: [
      { label: "Before", amount: "300–500 ml", tip: "in the hour before; stop 15–20 min out" },
      { label: "During", amount: duringAmount, tip: duringTip },
      { label: "After", amount: "500+ ml", tip: "finish this bottle to rehydrate and refuel" },
    ],
    extra:
      input.temp === "hot"
        ? "Hot conditions — add plain water alongside the mix rather than making it stronger."
        : null,
  };
}
