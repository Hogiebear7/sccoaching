// Three previews of what's inside the member app, drawn to match how the app looks on a phone: rounded navy cards, the readiness
// week as soft green bars, macro chips with their colours, and the "Up next" class card. All numbers are representative sample data.

const READINESS_WEEK = [70, 78, 74, 81, 76, 72, 75];

const CARD = "rounded-[22px] border border-white/[0.06] bg-[#111e34] p-5";

function UpNextPreview() {
  return (
    <div className={CARD}>
      <div className="mb-4 flex items-baseline justify-between">
        <span className="text-headline text-[26px] text-zinc-50">Up next</span>
        <span className="text-sm text-zinc-400">Schedule</span>
      </div>
      <div className="flex items-center gap-4 rounded-2xl bg-[#0b1527] p-3">
        <div className="rounded-xl bg-[#17263f] px-3 py-2 text-center">
          <p className="text-[11px] text-zinc-400">Thu 29 Oct</p>
          <p className="text-headline text-[26px] leading-none text-zinc-50">07:00</p>
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-zinc-50">Morning Strength</p>
          <p className="mt-0.5 text-sm text-zinc-400">50 min · Coached small group</p>
        </div>
      </div>
    </div>
  );
}

function FuelPreview() {
  const target = 2450;
  const logged = 2180;
  const macros = [
    { name: "Protein", value: 142, target: 170, color: "#e0645f" },
    { name: "Carbs", value: 238, target: 290, color: "#7fcf9f" },
    { name: "Fat", value: 64, target: 72, color: "#e8964a" },
  ];
  return (
    <div className={CARD}>
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-headline text-[26px] text-zinc-50">Nutrition</span>
        <span className="text-sm text-zinc-400">Today</span>
      </div>
      <p className="text-headline text-[44px] leading-none text-zinc-50 tabular-nums">
        {logged.toLocaleString("en-IE")}
        <span className="ml-1.5 font-sans text-sm font-normal normal-case tracking-normal text-zinc-400">/ {target.toLocaleString("en-IE")} kcal</span>
      </p>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.1]">
        <div className="h-full rounded-full bg-white" style={{ width: `${(logged / target) * 100}%` }} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2.5">
        {macros.map((m) => (
          <div key={m.name} className="rounded-2xl bg-[#0b1527] p-3">
            <p className="flex items-center gap-1.5 text-xs text-zinc-300">
              <span className="h-2 w-2 rounded-full" style={{ background: m.color }} />
              {m.name}
            </p>
            <p className="mt-1 text-lg font-semibold text-zinc-50 tabular-nums">
              {m.value}
              <span className="text-xs font-normal text-zinc-400"> / {m.target}g</span>
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.1]">
              <div className="h-full rounded-full" style={{ width: `${(m.value / m.target) * 100}%`, background: m.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReadinessPreview() {
  return (
    <div className={CARD}>
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-headline text-[26px] text-zinc-50">Recovery</span>
        <span className="text-sm text-zinc-400">Last 7 days</span>
      </div>
      <div className="flex items-end justify-between gap-6">
        <div>
          <p className="text-sm text-zinc-400">Readiness today</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-headline text-[44px] leading-none text-[#7fcf9f]">75</span>
            <span className="text-lg font-semibold text-zinc-50">Ready</span>
          </p>
          <p className="mt-1 max-w-[26ch] text-sm leading-snug text-zinc-400">Solid recovery. Train as planned.</p>
        </div>
        <div className="flex h-16 items-end gap-1.5" role="img" aria-label="Readiness over the last seven days">
          {READINESS_WEEK.map((v, i) => (
            <div
              key={i}
              className="w-3 rounded-[5px]"
              style={{ height: `${(v / 100) * 64}px`, background: i === READINESS_WEEK.length - 1 ? "#7fcf9f" : "#3f7a5c" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function MemberPreviewStack() {
  return (
    <div className="space-y-4">
      <div className="max-lg:hidden">
        <UpNextPreview />
      </div>
      <FuelPreview />
      <ReadinessPreview />
    </div>
  );
}
