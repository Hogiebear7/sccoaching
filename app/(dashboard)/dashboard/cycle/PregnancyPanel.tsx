"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PregnancyEstimate } from "@/lib/pregnancy";
import type { TrainingGuidance } from "@/lib/pregnancy-training";

function inputClass() {
  return "w-full rounded-lg border border-border bg-input px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20";
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

// Pregnancy, the birth and breastfeeding on the web — the same record and
// route (/api/pregnancy/status) the phone app uses. Private by default; the
// member can share with their coach at any stage.
export function PregnancyPanel({
  isPregnant: initialPregnant,
  shareWithCoach: initialShare,
  birthDate: initialBirthDate,
  breastfeeding: initialBreastfeeding,
  estimate,
  training,
}: {
  isPregnant: boolean;
  shareWithCoach: boolean;
  birthDate: string | null;
  breastfeeding: boolean | null;
  estimate: PregnancyEstimate;
  training: TrainingGuidance | null;
}) {
  const router = useRouter();
  const [pregnant, setPregnant] = useState(initialPregnant);
  const [weeks, setWeeks] = useState(estimate.weeksPregnant !== null ? String(estimate.weeksPregnant) : "");
  const [share, setShare] = useState(initialShare);
  const [birthDate, setBirthDate] = useState(initialBirthDate ?? "");
  const [breastfeeding, setBreastfeeding] = useState(initialBreastfeeding === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const born = initialPregnant && estimate.trimester === "postpartum";

  async function save(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/pregnancy/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "Could not save.");
        return;
      }
      setNotice(
        data?.data?.goalPaused
          ? "Saved. Your weight goal is paused while you're pregnant: your calorie target is set to maintain your weight, with extra calories added as your pregnancy goes on."
          : done
      );
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const content = estimate.content;

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h3 className="text-lg font-semibold">Pregnancy</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        Turning this on pauses cycle tracking and adjusts your calorie target and training guidance for your stage.
        It&apos;s private unless you choose to share it with your coach.
      </p>

      <label className="mt-5 flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-foreground">I&apos;m currently pregnant (or have had my baby in the last few months)</span>
        <input
          type="checkbox"
          checked={pregnant}
          onChange={(e) => {
            setPregnant(e.target.checked);
            if (!e.target.checked && initialPregnant) void save({ isPregnant: false }, "Pregnancy tracking switched off.");
          }}
          className="h-5 w-5 accent-[var(--primary)]"
        />
      </label>

      {pregnant && !born ? (
        <form
          className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(weeks);
            if (!Number.isFinite(n) || n < 0 || n > 45) {
              setError("Enter how many weeks along you are (0–45).");
              return;
            }
            void save({ isPregnant: true, weeksAlong: n, shareWithCoach: share }, "Saved.");
          }}
        >
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">How many weeks along are you?</span>
            <input type="number" min={0} max={45} value={weeks} onChange={(e) => setWeeks(e.target.value)} className={inputClass()} />
          </label>
          <button type="submit" disabled={busy} className="btn-primary px-5 py-3 text-sm disabled:opacity-60">
            {initialPregnant ? "Update" : "Save"}
          </button>
        </form>
      ) : null}

      {initialPregnant ? (
        <div className="mt-6 space-y-4 border-t border-border pt-5">
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm text-foreground">Share my pregnancy with my coach</span>
            <input
              type="checkbox"
              checked={share}
              onChange={(e) => {
                setShare(e.target.checked);
                void save({ isPregnant: true, shareWithCoach: e.target.checked }, e.target.checked ? "Shared with your coach." : "No longer shared.");
              }}
              className="h-5 w-5 accent-[var(--primary)]"
            />
          </label>

          <form
            className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (!birthDate) {
                setError("Enter your baby's birth date.");
                return;
              }
              void save({ isPregnant: true, birthDate, breastfeeding, shareWithCoach: share }, "Congratulations! Saved.");
            }}
          >
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-foreground">Baby has arrived? Birth date</span>
              <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className={inputClass()} />
            </label>
            <button type="submit" disabled={busy} className="btn-primary px-5 py-3 text-sm disabled:opacity-60">
              {initialBirthDate ? "Update" : "Save"}
            </button>
          </form>

          {born || initialBirthDate ? (
            <label className="flex items-center justify-between gap-4">
              <span className="text-sm text-foreground">
                I&apos;m breastfeeding
                <span className="block text-xs text-muted-foreground">
                  Adds about 500 kcal a day to your target. Turn this off when you stop.
                </span>
              </span>
              <input
                type="checkbox"
                checked={breastfeeding}
                onChange={(e) => {
                  setBreastfeeding(e.target.checked);
                  void save(
                    { isPregnant: true, breastfeeding: e.target.checked, shareWithCoach: share },
                    e.target.checked ? "Breastfeeding added to your target." : "Breastfeeding removed from your target."
                  );
                }}
                className="h-5 w-5 accent-[var(--primary)]"
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="mt-4 text-sm text-[var(--success)]">{notice}</p> : null}

      {initialPregnant && content ? (
        <div className="mt-6 space-y-5 border-t border-border pt-5">
          <div>
            <p className="text-base font-semibold text-foreground">
              {content.label}
              {estimate.weeksPregnant !== null ? ` · week ${estimate.weeksPregnant}` : ""}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{content.summary}</p>
          </div>
          <List title="Eat and take" items={content.nutritionDo} />
          <List title="Avoid" items={content.nutritionAvoid} />
          {training ? (
            <div>
              <p className="text-sm font-semibold text-foreground">{training.headline}</p>
              <p className="mt-1 text-sm text-muted-foreground">{training.effort}</p>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
                {training.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <List title="Training: generally fine" items={content.trainingDo} />
              <List title="Training: avoid" items={content.trainingAvoid} />
            </>
          )}
          <List title="Recovery" items={content.recoveryDo} />
          <p className="text-xs text-muted-foreground/70">{estimate.disclaimer}</p>
        </div>
      ) : null}
    </div>
  );
}
