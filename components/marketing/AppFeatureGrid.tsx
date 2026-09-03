interface Feature {
  title: string;
  body: string;
  icon: string;
}

interface FeatureCategory {
  label: string;
  items: Feature[];
}

// Same 14 real, shipped features as before, now grouped into the app's three
// domains (Workouts / Recovery / Nutrition) instead of one flat grid — a
// visitor scanning for "what does it do for my training" shouldn't have to
// read past nutrition items to find it. The AI/human coach spans training
// and nutrition in the app itself (one chat, context from both), so it's
// grouped under Recovery rather than invented as a 4th category or
// duplicated — its context chips (readiness/load) make Recovery the closer
// fit of the two.
const CATEGORIES: FeatureCategory[] = [
  {
    label: "Workouts",
    items: [
      {
        title: "Workout generator",
        body: "Builds a session from your equipment and time, then scales sets, reps, and exercise count to today's readiness, training load, and anything already planned or booked.",
        icon: "M4 9v6M20 9v6M7 7v10M17 7v10M9 12h6",
      },
      {
        title: "Exercise library",
        body: "Searchable database with GIF demonstrations, muscles worked, and instructions — filter to only what your active gym profile has available.",
        icon: "M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z M6 21a2 2 0 0 1 0-4h13",
      },
      {
        title: "Gym profiles",
        body: "Save equipment profiles for home, your gym, or travel. The generator and library adapt to whichever one's active.",
        icon: "M8 8a4 4 0 1 1 4 4 M16 16a4 4 0 1 1-4-4",
      },
      {
        title: "Workout logging",
        body: "Six formats — Standard, Chipper, Circuit, AMRAP, EMOM, Tabata — logged fresh, from a saved template, a program day, or a generated session.",
        icon: "M9 5H7a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2 M8 4h8v3H8V4Z M9 13l2 2 4-4",
      },
      {
        title: "Weekly training plan",
        body: "Map your recurring week — gym, sport, cardio, rest — so your coach sees your real training load, not just what's logged.",
        icon: "M4 5h16v15H4V5Z M4 9h16 M8 3v4 M16 3v4",
      },
      {
        title: "Training trends",
        body: "Weekly volume and set trends, your top exercises, and a bodyweight chart tracked from your logged history.",
        icon: "M4 20V10M10 20V4M16 20v-7M22 20H2",
      },
    ],
  },
  {
    label: "Recovery",
    items: [
      {
        title: "Recovery & readiness",
        body: "A daily check-in on sleep, soreness, and fatigue produces a readiness score that shapes your training and nutrition targets.",
        icon: "M12 21s-7-4.6-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.4-9.5 9-9.5 9Z",
      },
      {
        title: "AI & human coach",
        body: "Chat with a coach that knows your real readiness, training load, and history — covers training and nutrition questions alike — or message your human coach directly.",
        icon: "M4 5h16v11H8l-4 4V5Z",
      },
    ],
  },
  {
    label: "Nutrition",
    items: [
      {
        title: "Nutrition & food logging",
        body: "A meal-by-meal diary with search, favourites, and recent foods, backed by a full food catalog.",
        icon: "M7 3v7a2 2 0 0 0 4 0V3 M9 10v11 M17 3c-1.7 0-3 1.5-3 4s1.3 4 3 4 M17 3v18",
      },
      {
        title: "Photo & barcode logging",
        body: "Scan a barcode, snap a photo, or describe a meal in words — it fills in the macros for you to review before saving.",
        icon: "M4 8h3l1.5-2h7L17 8h3v11H4V8Z M12 13.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
      },
      {
        title: "What can I make?",
        body: "Photograph your ingredients, a receipt, or just describe what's in the fridge — get meal ideas built from what you actually have.",
        icon: "M4 12h16 M6 12a6 6 0 0 1 12 0 M4 12v6h16v-6",
      },
      {
        title: "Shopping list",
        body: "Add items by hand or pull straight from a saved recipe, then check things off as you shop.",
        icon: "M6 8h12l-1 12H7L6 8Z M9 8V6a3 3 0 0 1 6 0v2",
      },
      {
        title: "Sports drink calculator",
        body: "A drink recipe sized to your bodyweight and session — carbs, sodium, and electrolytes tuned to your sport, distance, and conditions.",
        icon: "M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z",
      },
      {
        title: "Weight goal timeline",
        body: "Set a goal weight and training frequency for a realistic target date, plus a second projection based on your actual logged trend.",
        icon: "M5 21V4 M5 4h13l-3 4 3 4H5",
      },
    ],
  },
];

function FeatureIcon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-5 w-5 text-gold"
    >
      <path d={path} />
    </svg>
  );
}

export function AppFeatureGrid() {
  return (
    <div className="space-y-12">
      {CATEGORIES.map((category) => (
        <div key={category.label}>
          <p className="text-mono flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-gold">
            <span className="h-px w-6 bg-primary/70" />
            {category.label}
          </p>
          <div className="mt-5 grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {category.items.map((item) => (
              <div key={item.title} className="flex gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10">
                  <FeatureIcon path={item.icon} />
                </span>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-50">{item.title}</h4>
                  <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
