// Three compact previews of what's inside the member area — training,
// nutrition, and recovery — replacing the single Session Ledger in the hero.
// Same signature-panel language as Ledger (solid surface, hairline border,
// gold top accent, mono data type) so they read as one family, not three
// unrelated widgets. The recovery card reuses the real ReadinessRing
// component used on the actual dashboard — everything else here is
// representative sample data, same as the Ledger's own SAMPLE_LEDGER_ROWS.
import { ReadinessRing } from "@/components/ui/ReadinessRing";

const WEEKDAY_VOLUME: { day: string; value: number }[] = [
  { day: "M", value: 55 },
  { day: "T", value: 80 },
  { day: "W", value: 0 },
  { day: "T", value: 65 },
  { day: "F", value: 95 },
  { day: "S", value: 40 },
  { day: "S", value: 0 },
];

function PreviewCard({
  title,
  tag,
  children,
}: {
  title: string;
  tag: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative border border-white/[0.08] bg-[var(--surface-1)] p-5">
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary to-transparent" />
      <div className="mb-4 flex items-baseline justify-between">
        <span className="text-editorial text-[15px] italic text-zinc-50">{title}</span>
        <span className="text-mono text-[10px] uppercase tracking-[0.08em] text-gold">{tag}</span>
      </div>
      {children}
    </div>
  );
}

function TrainingPreview() {
  const max = Math.max(...WEEKDAY_VOLUME.map((d) => d.value), 1);

  return (
    <PreviewCard title="Training Log" tag="This Week">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-mono text-[26px] font-semibold leading-none text-gold tabular-nums">
            5<span className="ml-1 text-[12px] font-normal text-zinc-500">sessions</span>
          </p>
          <p className="mt-2 text-[12px] text-zinc-500">3,180kg logged this week</p>
        </div>
        <div className="flex h-14 items-end gap-1.5" role="img" aria-label="Training volume by day, Monday to Sunday">
          {WEEKDAY_VOLUME.map((d, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <div
                className={`w-2.5 rounded-t-[3px] ${d.value > 0 ? "bg-primary" : "bg-white/[0.08]"}`}
                style={{ height: `${Math.max((d.value / max) * 40, 3)}px` }}
              />
              <span className="text-[9px] text-zinc-600">{d.day}</span>
            </div>
          ))}
        </div>
      </div>
    </PreviewCard>
  );
}

function NutritionPreview() {
  const targetKcal = 2450;
  const loggedKcal = 2180;
  const pct = Math.min(loggedKcal / targetKcal, 1);

  return (
    <PreviewCard title="Fuel Tracking" tag="Today">
      <p className="text-mono text-[26px] font-semibold leading-none text-gold tabular-nums">
        {loggedKcal}
        <span className="ml-1 text-[12px] font-normal text-zinc-500">/ {targetKcal} kcal</span>
      </p>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct * 100}%` }} />
      </div>
      <p className="mt-2.5 text-[12px] text-zinc-500">142g protein · on target</p>
    </PreviewCard>
  );
}

function RecoveryPreview() {
  return (
    <PreviewCard title="Recovery" tag="Readiness">
      <div className="flex items-center gap-4">
        <ReadinessRing score={82} size={64} />
        <div>
          <p className="text-[13px] text-zinc-200">Well recovered</p>
          <p className="mt-1 text-[12px] text-zinc-500">Follicular phase · Day 9</p>
        </div>
      </div>
    </PreviewCard>
  );
}

export function MemberPreviewStack() {
  return (
    <div className="space-y-4">
      <TrainingPreview />
      <NutritionPreview />
      <RecoveryPreview />
    </div>
  );
}
