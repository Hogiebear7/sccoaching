// Checked-in reference data for the "Equipment Available" / Gym Profiles
// feature — deliberately NOT a database table. It's small, changes rarely,
// and needs no admin editor, so a source-controlled module satisfies
// "extendable" without inventing migration machinery for it. If a staff
// equipment-catalog editor is ever wanted, this can migrate into the JSON
// store the same way DEFAULT_CLASS_CATEGORIES seeds classCategories.
//
// Labels use common Irish/UK gym-floor wording where that differs from the
// clinical/American term (e.g. "Cross trainer" not "Elliptical machine").
// Slugs are the clean, standardised backend identifiers — never shown to
// users, never renamed once shipped (member gym profiles reference them).
//
// aliases serves two purposes at once (see lib/equipment-matching.ts):
//   1. search synonyms in the equipment picker UI
//   2. matching this catalog item against the free-text `equipment` string
//      already on lib/exercise-library records (e.g. ExerciseDB's raw
//      vendor values like "body weight", "leverage machine", "cable") —
//      compared case-insensitively, so casing here doesn't matter.

export interface EquipmentCategoryDef {
  slug: string;
  label: string;
}

export interface EquipmentDef {
  slug: string;
  label: string;
  category: string;
  subcategory: string | null;
  aliases: string[];
  sortOrder: number;
}

export const EQUIPMENT_CATEGORIES: EquipmentCategoryDef[] = [
  { slug: "free-weights", label: "Free Weights" },
  { slug: "benches-racks", label: "Benches & Racks" },
  { slug: "cable-pulley", label: "Cable & Pulley" },
  { slug: "machines", label: "Plate-Loaded & Selectorised Machines" },
  { slug: "bodyweight-floor", label: "Bodyweight & Floor" },
  { slug: "strongman-functional", label: "Strongman & Functional" },
  { slug: "cardio", label: "Cardio" },
];

export const EQUIPMENT_CATALOG: EquipmentDef[] = [
  // ── Free weights ──────────────────────────────────────────────────────
  { slug: "barbell", label: "Barbell", category: "free-weights", subcategory: null, aliases: ["olympic barbell", "olympic bar", "straight bar", "bb"], sortOrder: 100 },
  { slug: "ez-curl-bar", label: "EZ curl bar", category: "free-weights", subcategory: null, aliases: ["ez bar", "ez barbell", "curl bar"], sortOrder: 101 },
  { slug: "trap-bar", label: "Trap bar", category: "free-weights", subcategory: null, aliases: ["hex bar"], sortOrder: 102 },
  { slug: "fixed-barbell", label: "Fixed barbell", category: "free-weights", subcategory: null, aliases: ["fixed weight barbell", "pre-loaded barbell"], sortOrder: 103 },
  { slug: "dumbbells", label: "Dumbbells", category: "free-weights", subcategory: null, aliases: ["dumbbell", "db", "dbs"], sortOrder: 104 },
  { slug: "adjustable-dumbbells", label: "Adjustable dumbbells", category: "free-weights", subcategory: null, aliases: ["selectorised dumbbells", "adjustable db"], sortOrder: 105 },
  { slug: "kettlebells", label: "Kettlebells", category: "free-weights", subcategory: null, aliases: ["kettlebell", "kb", "kbs"], sortOrder: 106 },
  { slug: "weight-plates", label: "Weight plates", category: "free-weights", subcategory: null, aliases: ["plates", "bumper plates", "iron plates"], sortOrder: 107 },
  { slug: "fractional-plates", label: "Fractional plates", category: "free-weights", subcategory: null, aliases: ["micro plates", "small plates"], sortOrder: 108 },
  { slug: "weight-vest", label: "Weight vest", category: "free-weights", subcategory: null, aliases: ["weighted vest"], sortOrder: 109 },
  { slug: "chains", label: "Chains", category: "free-weights", subcategory: null, aliases: ["lifting chains"], sortOrder: 110 },
  { slug: "resistance-bands", label: "Resistance bands", category: "free-weights", subcategory: null, aliases: ["resistance band", "band", "bands", "loop bands"], sortOrder: 111 },
  { slug: "mini-bands", label: "Mini bands", category: "free-weights", subcategory: null, aliases: ["glute bands", "hip bands", "booty bands"], sortOrder: 112 },
  { slug: "suspension-trainer", label: "Suspension trainer", category: "free-weights", subcategory: null, aliases: ["trx", "straps"], sortOrder: 113 },
  { slug: "medicine-ball", label: "Medicine ball", category: "free-weights", subcategory: null, aliases: ["med ball"], sortOrder: 114 },
  { slug: "slam-ball", label: "Slam ball", category: "free-weights", subcategory: null, aliases: ["dead ball"], sortOrder: 115 },
  { slug: "sandbag", label: "Sandbag", category: "free-weights", subcategory: null, aliases: [], sortOrder: 116 },
  { slug: "bulgarian-bag", label: "Bulgarian bag", category: "free-weights", subcategory: null, aliases: [], sortOrder: 117 },
  { slug: "macebell", label: "Macebell", category: "free-weights", subcategory: null, aliases: ["mace"], sortOrder: 118 },
  { slug: "clubbell", label: "Clubbell", category: "free-weights", subcategory: null, aliases: ["club bell", "steel club"], sortOrder: 119 },

  // ── Benches and racks ────────────────────────────────────────────────
  { slug: "flat-bench", label: "Flat bench", category: "benches-racks", subcategory: null, aliases: ["bench"], sortOrder: 200 },
  { slug: "adjustable-bench", label: "Adjustable bench", category: "benches-racks", subcategory: null, aliases: ["incline bench"], sortOrder: 201 },
  { slug: "fid-bench", label: "FID bench", category: "benches-racks", subcategory: null, aliases: ["flat incline decline bench"], sortOrder: 202 },
  { slug: "squat-rack", label: "Squat rack", category: "benches-racks", subcategory: null, aliases: ["rack"], sortOrder: 203 },
  { slug: "half-rack", label: "Half rack", category: "benches-racks", subcategory: null, aliases: ["rack"], sortOrder: 204 },
  { slug: "power-rack", label: "Power rack", category: "benches-racks", subcategory: null, aliases: ["power cage", "rack"], sortOrder: 205 },
  { slug: "squat-stands", label: "Squat stands", category: "benches-racks", subcategory: null, aliases: ["squat stand"], sortOrder: 206 },
  { slug: "smith-machine", label: "Smith machine", category: "benches-racks", subcategory: null, aliases: [], sortOrder: 207 },
  { slug: "pull-up-bar", label: "Pull-up bar", category: "benches-racks", subcategory: null, aliases: ["chin-up bar"], sortOrder: 208 },
  { slug: "dip-station", label: "Dip station", category: "benches-racks", subcategory: null, aliases: ["dip bars", "dip stand"], sortOrder: 209 },
  { slug: "wall-bars", label: "Wall bars", category: "benches-racks", subcategory: null, aliases: ["stall bars"], sortOrder: 210 },
  { slug: "ghd", label: "GHD (Glute-Ham Developer)", category: "benches-racks", subcategory: null, aliases: ["glute ham developer", "glute-ham raise"], sortOrder: 211 },
  { slug: "roman-chair", label: "Roman chair", category: "benches-racks", subcategory: null, aliases: ["back extension bench", "hyperextension bench"], sortOrder: 212 },
  { slug: "preacher-curl-bench", label: "Preacher curl bench", category: "benches-racks", subcategory: null, aliases: ["preacher bench", "scott bench"], sortOrder: 213 },
  { slug: "sissy-squat-bench", label: "Sissy squat bench", category: "benches-racks", subcategory: null, aliases: [], sortOrder: 214 },

  // ── Cable and pulley ─────────────────────────────────────────────────
  { slug: "cable-machine", label: "Cable machine", category: "cable-pulley", subcategory: null, aliases: ["cable station", "pulley machine", "cable"], sortOrder: 300 },
  { slug: "functional-trainer", label: "Functional trainer", category: "cable-pulley", subcategory: null, aliases: [], sortOrder: 301 },
  { slug: "dual-adjustable-pulley", label: "Dual adjustable pulley", category: "cable-pulley", subcategory: null, aliases: ["dap"], sortOrder: 302 },
  { slug: "cable-column", label: "Cable column", category: "cable-pulley", subcategory: null, aliases: ["cable tower"], sortOrder: 303 },
  { slug: "lat-pulldown", label: "Lat pulldown", category: "cable-pulley", subcategory: null, aliases: [], sortOrder: 304 },
  { slug: "low-row-cable", label: "Low row", category: "cable-pulley", subcategory: null, aliases: ["seated row cable"], sortOrder: 305 },
  { slug: "seated-cable-row", label: "Seated cable row", category: "cable-pulley", subcategory: null, aliases: [], sortOrder: 306 },
  { slug: "cable-crossover", label: "Cable crossover", category: "cable-pulley", subcategory: null, aliases: ["crossover machine"], sortOrder: 307 },
  { slug: "rope-attachment", label: "Rope attachment", category: "cable-pulley", subcategory: null, aliases: ["tricep rope", "rope"], sortOrder: 308 },
  { slug: "straight-bar-attachment", label: "Straight bar attachment", category: "cable-pulley", subcategory: null, aliases: ["cable straight bar"], sortOrder: 309 },
  { slug: "ez-cable-attachment", label: "EZ cable attachment", category: "cable-pulley", subcategory: null, aliases: ["ez bar attachment"], sortOrder: 310 },
  { slug: "d-handle", label: "D-handle", category: "cable-pulley", subcategory: null, aliases: ["single handle", "d handle"], sortOrder: 311 },
  { slug: "ankle-strap", label: "Ankle strap", category: "cable-pulley", subcategory: null, aliases: ["cable ankle cuff"], sortOrder: 312 },
  { slug: "triceps-v-bar", label: "Triceps V-bar", category: "cable-pulley", subcategory: null, aliases: ["v-bar", "v bar attachment"], sortOrder: 313 },
  { slug: "multi-grip-pulldown-bar", label: "Multi-grip pulldown bar", category: "cable-pulley", subcategory: null, aliases: ["wide grip bar"], sortOrder: 314 },

  // ── Plate-loaded and selectorised machines ──────────────────────────
  { slug: "leg-press", label: "Leg press", category: "machines", subcategory: "legs", aliases: ["leverage machine"], sortOrder: 400 },
  { slug: "hack-squat", label: "Hack squat", category: "machines", subcategory: "legs", aliases: ["hack squat machine", "leverage machine"], sortOrder: 401 },
  { slug: "pendulum-squat", label: "Pendulum squat", category: "machines", subcategory: "legs", aliases: ["leverage machine"], sortOrder: 402 },
  { slug: "belt-squat", label: "Belt squat", category: "machines", subcategory: "legs", aliases: [], sortOrder: 403 },
  { slug: "leg-extension", label: "Leg extension", category: "machines", subcategory: "legs", aliases: ["leg extension machine"], sortOrder: 404 },
  { slug: "seated-leg-curl", label: "Seated leg curl", category: "machines", subcategory: "legs", aliases: [], sortOrder: 405 },
  { slug: "lying-leg-curl", label: "Lying leg curl", category: "machines", subcategory: "legs", aliases: ["prone leg curl"], sortOrder: 406 },
  { slug: "standing-leg-curl", label: "Standing leg curl", category: "machines", subcategory: "legs", aliases: [], sortOrder: 407 },
  { slug: "calf-raise-machine", label: "Calf raise machine", category: "machines", subcategory: "legs", aliases: ["seated calf raise", "standing calf raise"], sortOrder: 408 },
  { slug: "chest-press-machine", label: "Chest press machine", category: "machines", subcategory: "push", aliases: ["leverage machine"], sortOrder: 409 },
  { slug: "incline-press-machine", label: "Incline press machine", category: "machines", subcategory: "push", aliases: ["leverage machine"], sortOrder: 410 },
  { slug: "shoulder-press-machine", label: "Shoulder press machine", category: "machines", subcategory: "push", aliases: ["leverage machine"], sortOrder: 411 },
  { slug: "pec-deck", label: "Pec deck", category: "machines", subcategory: "push", aliases: ["chest fly machine", "butterfly machine"], sortOrder: 412 },
  { slug: "rear-delt-fly-machine", label: "Rear delt fly machine", category: "machines", subcategory: "pull", aliases: ["reverse fly machine"], sortOrder: 413 },
  { slug: "lat-pulldown-machine", label: "Lat pulldown machine", category: "machines", subcategory: "pull", aliases: ["selectorised lat pulldown"], sortOrder: 414 },
  { slug: "high-row-machine", label: "High row machine", category: "machines", subcategory: "pull", aliases: [], sortOrder: 415 },
  { slug: "low-row-machine", label: "Low row machine", category: "machines", subcategory: "pull", aliases: ["seated row machine"], sortOrder: 416 },
  { slug: "assisted-pull-up-dip-machine", label: "Assisted pull-up / dip machine", category: "machines", subcategory: "pull", aliases: ["assisted machine", "assisted pull-up", "assisted dip"], sortOrder: 417 },
  { slug: "hip-thrust-machine", label: "Hip thrust machine", category: "machines", subcategory: "glutes", aliases: [], sortOrder: 418 },
  { slug: "glute-kickback-machine", label: "Glute kickback machine", category: "machines", subcategory: "glutes", aliases: ["cable kickback machine"], sortOrder: 419 },
  { slug: "hip-abductor-machine", label: "Hip abductor machine", category: "machines", subcategory: "glutes", aliases: ["abductor machine"], sortOrder: 420 },
  { slug: "hip-adductor-machine", label: "Hip adductor machine", category: "machines", subcategory: "glutes", aliases: ["adductor machine", "inner thigh machine"], sortOrder: 421 },
  { slug: "adductor-abductor-combo-machine", label: "Adductor/abductor combo machine", category: "machines", subcategory: "glutes", aliases: [], sortOrder: 422 },
  { slug: "back-extension-machine", label: "Back extension machine", category: "machines", subcategory: "core", aliases: [], sortOrder: 423 },
  { slug: "ab-crunch-machine", label: "Ab crunch machine", category: "machines", subcategory: "core", aliases: ["abdominal machine"], sortOrder: 424 },
  { slug: "rotary-torso", label: "Rotary torso", category: "machines", subcategory: "core", aliases: ["torso rotation machine"], sortOrder: 425 },
  { slug: "biceps-curl-machine", label: "Biceps curl machine", category: "machines", subcategory: "arms", aliases: ["bicep curl machine"], sortOrder: 426 },
  { slug: "triceps-extension-machine", label: "Triceps extension machine", category: "machines", subcategory: "arms", aliases: ["tricep extension machine"], sortOrder: 427 },
  { slug: "tibialis-raise-station", label: "Tibialis raise station", category: "machines", subcategory: "legs", aliases: ["tib bar"], sortOrder: 428 },
  { slug: "neck-machine", label: "Neck machine", category: "machines", subcategory: null, aliases: ["neck harness"], sortOrder: 429 },

  // ── Bodyweight and floor ────────────────────────────────────────────
  { slug: "bodyweight-only", label: "Bodyweight only", category: "bodyweight-floor", subcategory: null, aliases: ["body weight", "no equipment", "none"], sortOrder: 500 },
  { slug: "floor-mat", label: "Floor mat", category: "bodyweight-floor", subcategory: null, aliases: ["exercise mat", "yoga mat"], sortOrder: 501 },
  { slug: "push-up-handles", label: "Push-up handles", category: "bodyweight-floor", subcategory: null, aliases: ["press-up handles", "push-up bars"], sortOrder: 502 },
  { slug: "parallettes", label: "Parallettes", category: "bodyweight-floor", subcategory: null, aliases: [], sortOrder: 503 },
  { slug: "gym-rings", label: "Gym rings", category: "bodyweight-floor", subcategory: null, aliases: ["gymnastic rings"], sortOrder: 504 },
  { slug: "ab-wheel", label: "Ab wheel", category: "bodyweight-floor", subcategory: null, aliases: ["wheel roller", "ab roller"], sortOrder: 505 },
  { slug: "sliders", label: "Sliders", category: "bodyweight-floor", subcategory: null, aliases: ["gliding discs", "core sliders"], sortOrder: 506 },
  { slug: "yoga-block", label: "Yoga block", category: "bodyweight-floor", subcategory: null, aliases: [], sortOrder: 507 },
  { slug: "foam-roller", label: "Foam roller", category: "bodyweight-floor", subcategory: null, aliases: ["roller"], sortOrder: 508 },
  { slug: "mobility-stick", label: "Mobility stick", category: "bodyweight-floor", subcategory: null, aliases: ["dowel", "mobility dowel"], sortOrder: 509 },
  { slug: "squat-wedge", label: "Squat wedge", category: "bodyweight-floor", subcategory: null, aliases: ["wedge block", "slant board"], sortOrder: 510 },

  // ── Strongman and functional ────────────────────────────────────────
  { slug: "sled", label: "Sled", category: "strongman-functional", subcategory: null, aliases: ["prowler", "push sled", "sled machine"], sortOrder: 600 },
  { slug: "sled-harness", label: "Sled harness", category: "strongman-functional", subcategory: null, aliases: ["pull harness"], sortOrder: 601 },
  { slug: "battle-ropes", label: "Battle ropes", category: "strongman-functional", subcategory: null, aliases: ["battling ropes"], sortOrder: 602 },
  { slug: "tyres", label: "Tyres", category: "strongman-functional", subcategory: null, aliases: ["tires", "tyre flip", "tire flip"], sortOrder: 603 },
  { slug: "farmers-walk-handles", label: "Farmers walk handles", category: "strongman-functional", subcategory: null, aliases: ["farmer's carry handles"], sortOrder: 604 },
  { slug: "yoke", label: "Yoke", category: "strongman-functional", subcategory: null, aliases: [], sortOrder: 605 },
  { slug: "plyo-box", label: "Plyo box", category: "strongman-functional", subcategory: null, aliases: ["plyometric box", "jump box"], sortOrder: 606 },
  { slug: "hurdles", label: "Hurdles", category: "strongman-functional", subcategory: null, aliases: [], sortOrder: 607 },
  { slug: "agility-ladder", label: "Agility ladder", category: "strongman-functional", subcategory: null, aliases: ["speed ladder"], sortOrder: 608 },
  { slug: "resistance-parachute", label: "Resistance parachute", category: "strongman-functional", subcategory: null, aliases: ["running parachute"], sortOrder: 609 },
  { slug: "timing-gates", label: "Timing gates", category: "strongman-functional", subcategory: null, aliases: ["speed gates"], sortOrder: 610 },
  { slug: "cones", label: "Cones", category: "strongman-functional", subcategory: null, aliases: ["markers"], sortOrder: 611 },
  { slug: "landmine", label: "Landmine", category: "strongman-functional", subcategory: null, aliases: ["landmine attachment"], sortOrder: 612 },
  { slug: "rope-climb-station", label: "Rope climb station", category: "strongman-functional", subcategory: null, aliases: ["climbing rope"], sortOrder: 613 },

  // ── Cardio ───────────────────────────────────────────────────────────
  { slug: "treadmill", label: "Treadmill", category: "cardio", subcategory: null, aliases: [], sortOrder: 700 },
  { slug: "curved-treadmill", label: "Curved treadmill", category: "cardio", subcategory: null, aliases: ["manual treadmill"], sortOrder: 701 },
  { slug: "exercise-bike", label: "Exercise bike", category: "cardio", subcategory: null, aliases: ["stationary bike"], sortOrder: 702 },
  { slug: "spin-bike", label: "Spin bike", category: "cardio", subcategory: null, aliases: ["indoor cycle"], sortOrder: 703 },
  { slug: "air-bike", label: "Air bike", category: "cardio", subcategory: null, aliases: ["assault bike", "fan bike", "watt bike"], sortOrder: 704 },
  { slug: "rower", label: "Rower", category: "cardio", subcategory: null, aliases: ["rowing machine", "erg"], sortOrder: 705 },
  { slug: "skierg", label: "SkiErg", category: "cardio", subcategory: null, aliases: ["ski erg", "skierg machine"], sortOrder: 706 },
  { slug: "cross-trainer", label: "Cross trainer", category: "cardio", subcategory: null, aliases: ["elliptical", "elliptical machine"], sortOrder: 707 },
  { slug: "stair-climber", label: "Stair climber", category: "cardio", subcategory: null, aliases: ["stairmaster"], sortOrder: 708 },
  { slug: "stepper", label: "Stepper", category: "cardio", subcategory: null, aliases: ["step machine"], sortOrder: 709 },
  { slug: "jacobs-ladder", label: "Jacobs Ladder", category: "cardio", subcategory: null, aliases: [], sortOrder: 710 },
  { slug: "versaclimber", label: "VersaClimber", category: "cardio", subcategory: null, aliases: ["versa climber"], sortOrder: 711 },
  { slug: "pool", label: "Pool", category: "cardio", subcategory: null, aliases: ["swimming pool"], sortOrder: 712 },
  { slug: "outdoor-running", label: "Outdoor running", category: "cardio", subcategory: null, aliases: ["running outdoors"], sortOrder: 713 },
];

export function findEquipmentBySlug(slug: string): EquipmentDef | undefined {
  return EQUIPMENT_CATALOG.find((e) => e.slug === slug);
}

export const GYM_PROFILE_PRESETS: { slug: string; name: string; icon: string; equipmentSlugs: string[] }[] = [
  {
    slug: "home-gym",
    name: "Home Gym",
    icon: "🏠",
    equipmentSlugs: [
      "dumbbells", "adjustable-dumbbells", "kettlebells", "resistance-bands", "mini-bands",
      "suspension-trainer", "flat-bench", "adjustable-bench", "pull-up-bar", "floor-mat",
      "foam-roller", "bodyweight-only",
    ],
  },
  {
    slug: "commercial-gym",
    name: "Commercial Gym",
    icon: "🏋️",
    equipmentSlugs: [
      "barbell", "ez-curl-bar", "trap-bar", "dumbbells", "adjustable-dumbbells", "kettlebells",
      "weight-plates", "flat-bench", "adjustable-bench", "squat-rack", "power-rack", "smith-machine",
      "pull-up-bar", "dip-station", "cable-machine", "functional-trainer", "lat-pulldown",
      "seated-cable-row", "leg-press", "hack-squat", "leg-extension", "seated-leg-curl",
      "lying-leg-curl", "calf-raise-machine", "chest-press-machine", "shoulder-press-machine",
      "pec-deck", "lat-pulldown-machine", "low-row-machine", "back-extension-machine",
      "ab-crunch-machine", "treadmill", "exercise-bike", "rower", "cross-trainer", "stair-climber",
      "battle-ropes", "landmine", "medicine-ball", "bodyweight-only",
    ],
  },
  {
    slug: "hotel-gym",
    name: "Hotel Gym",
    icon: "🧳",
    equipmentSlugs: [
      "dumbbells", "adjustable-bench", "cable-machine", "functional-trainer", "treadmill",
      "exercise-bike", "cross-trainer", "bodyweight-only", "floor-mat",
    ],
  },
  {
    slug: "minimal-equipment",
    name: "Minimal Equipment",
    icon: "🎒",
    equipmentSlugs: ["resistance-bands", "mini-bands", "kettlebells", "floor-mat", "bodyweight-only"],
  },
  {
    slug: "rehab-physio",
    name: "Rehab / Physio Setup",
    icon: "🩹",
    equipmentSlugs: [
      "resistance-bands", "mini-bands", "floor-mat", "foam-roller", "mobility-stick",
      "yoga-block", "squat-wedge", "sliders", "ankle-strap", "cable-machine", "bodyweight-only",
    ],
  },
];
