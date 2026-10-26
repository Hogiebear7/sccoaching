"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { menopauseContentFor, type MenopausePoint } from "@/lib/menopause";
import type { MenopauseStage } from "@/lib/profile-schema";

const STAGES: { value: MenopauseStage; label: string; detail: string }[] = [
  { value: "perimenopause", label: "Perimenopause", detail: "Periods still come but are changing" },
  { value: "postmenopause", label: "Post-menopause", detail: "12 months or more since your last period" },
];

function Points({ title, points }: { title: string; points: MenopausePoint[] }) {
  return (
    <div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <ul className="mt-2 space-y-2.5">
        {points.map((p) => (
          <li key={p.text} className="text-sm leading-relaxed text-muted-foreground">
            {p.text}{" "}
            <span className="whitespace-nowrap rounded-[3px] bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-semibold text-zinc-300">
              {p.evidence}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Menopause support on the web: the member picks their stage, sees the
// evidence-labelled advice (lib/menopause.ts) and chooses whether their
// coach can see the stage. Saves through /api/cycle/preferences.
export function MenopausePanel({
  stage: initialStage,
  shareWithCoach: initialShare,
}: {
  stage: MenopauseStage | null;
  shareWithCoach: boolean;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<MenopauseStage | null>(initialStage);
  const [share, setShare] = useState(initialShare);
  const [error, setError] = useState<string | null>(null);

  async function save(body: Record<string, unknown>) {
    setError(null);
    try {
      const res = await fetch("/api/cycle/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.message ?? "Could not save.");
        return;
      }
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    }
  }

  const content = menopauseContentFor(stage);

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">Menopause support</h3>
        <span className="text-xs text-muted-foreground">Evidence-based guidance, not medical advice</span>
      </div>

      <p className="mt-4 text-sm font-medium text-foreground">Which stage are you at?</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {STAGES.map((s) => {
          const active = stage === s.value;
          return (
            <button
              key={s.value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setStage(s.value);
                void save({ menopauseStage: s.value });
              }}
              className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                active ? "border-primary/60 bg-primary/10" : "border-border hover:border-white/20"
              }`}
            >
              <span className="block text-sm font-semibold text-foreground">{s.label}</span>
              <span className="block text-xs text-muted-foreground">{s.detail}</span>
            </button>
          );
        })}
      </div>

      {stage ? (
        <label className="mt-4 flex items-center justify-between gap-4">
          <span className="text-sm text-foreground">Share my stage with my coach</span>
          <input
            type="checkbox"
            checked={share}
            onChange={(e) => {
              setShare(e.target.checked);
              void save({ menopauseShareWithCoach: e.target.checked });
            }}
            className="h-5 w-5 accent-[var(--primary)]"
          />
        </label>
      ) : null}

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      {content ? (
        <div className="mt-6 space-y-5 border-t border-border pt-5">
          <p className="text-sm leading-relaxed text-muted-foreground">{content.summary}</p>
          <Points title="Training" points={content.training} />
          <Points title="Nutrition" points={content.nutrition} />
          <Points title="Recovery and sleep" points={content.recovery} />
          <p className="text-xs text-muted-foreground/70">{content.disclaimer}</p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">Choose your stage to see guidance for it.</p>
      )}
    </div>
  );
}
