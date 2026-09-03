interface Feature {
  title: string;
  body: string;
}

// One row per real, shipped feature in the mobile app — kept factual and
// specific rather than benefit-y (that tone already lives in AppShowcase's
// APP_BENEFITS above this on the page). Order roughly follows the app's own
// flow: train, log, recover, eat, plan, get coached.
const FEATURES: Feature[] = [
  {
    title: "Workout generator",
    body: "Builds a session from your equipment and time, then scales sets, reps, and exercise count to today's readiness, training load, and anything already planned or booked.",
  },
  {
    title: "Exercise library",
    body: "Searchable database with GIF demonstrations, muscles worked, and instructions — filter to only what your active gym profile has available.",
  },
  {
    title: "Gym profiles",
    body: "Save equipment profiles for home, your gym, or travel. The generator and library adapt to whichever one's active.",
  },
  {
    title: "Workout logging",
    body: "Six formats — Standard, Chipper, Circuit, AMRAP, EMOM, Tabata — logged fresh, from a saved template, a program day, or a generated session.",
  },
  {
    title: "Weekly training plan",
    body: "Map your recurring week — gym, sport, cardio, rest — so your coach sees your real training load, not just what's logged.",
  },
  {
    title: "Training trends",
    body: "Weekly volume and set trends, your top exercises, and a bodyweight chart tracked from your logged history.",
  },
  {
    title: "Recovery & readiness",
    body: "A daily check-in on sleep, soreness, and fatigue produces a readiness score that shapes your training and nutrition targets.",
  },
  {
    title: "Weight goal timeline",
    body: "Set a goal weight and training frequency for a realistic target date, plus a second projection based on your actual logged trend.",
  },
  {
    title: "Nutrition & food logging",
    body: "A meal-by-meal diary with search, favourites, and recent foods, backed by a full food catalog.",
  },
  {
    title: "Photo & barcode logging",
    body: "Scan a barcode, snap a photo, or describe a meal in words — it fills in the macros for you to review before saving.",
  },
  {
    title: "What can I make?",
    body: "Photograph your ingredients, a receipt, or just describe what's in the fridge — get meal ideas built from what you actually have.",
  },
  {
    title: "Shopping list",
    body: "Add items by hand or pull straight from a saved recipe, then check things off as you shop.",
  },
  {
    title: "Sports drink calculator",
    body: "A drink recipe sized to your bodyweight and session — carbs, sodium, and electrolytes tuned to your sport, distance, and conditions.",
  },
  {
    title: "Nutrition & workout coach",
    body: "Chat with a coach that knows your real readiness, load, and training history — or message your actual coach directly.",
  },
];

export function AppFeatureGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {FEATURES.map((item) => (
        <div
          key={item.title}
          className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 transition-colors duration-200 hover:border-primary/30"
        >
          <h4 className="text-sm font-semibold text-zinc-50">{item.title}</h4>
          <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">{item.body}</p>
        </div>
      ))}
    </div>
  );
}
