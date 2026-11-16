"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Form = {
  needed: boolean;
  current: boolean;
  questions: { id: string; text: string }[];
  intro: string;
  consent: string;
  declaration: string;
  footer: string;
};

// The web version of the quick health check (PAR-Q). Same wording and the same /api/parq as the phone app.
export function ParqForm() {
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [answers, setAnswers] = useState<Record<string, { yes: boolean | null; note: string }>>({});
  const [guardian, setGuardian] = useState("");
  const [consent, setConsent] = useState(false);
  const [declaration, setDeclaration] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/parq")
      .then((r) => r.json())
      .then((d) => (d?.data ? setForm(d.data as Form) : setLoadError(true)))
      .catch(() => setLoadError(true));
  }, []);

  async function save() {
    if (!form) return;
    setError(null);
    if (form.questions.some((q) => answers[q.id]?.yes == null)) return setError("Please answer every question with Yes or No.");
    if (!consent) return setError("Please tick the box to agree to us storing your answers.");
    if (!declaration) return setError("Please confirm your answers are true to the best of your knowledge.");
    setSaving(true);
    try {
      const res = await fetch("/api/parq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: Object.fromEntries(form.questions.map((q) => [q.id, { yes: answers[q.id].yes === true, note: answers[q.id].note.trim() }])),
          consent,
          declaration,
          guardianName: guardian.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return setError(data?.message ?? "Couldn't save. Please try again.");
      router.push("/dashboard/schedule");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <p className="text-sm text-muted-foreground">The health check isn&apos;t available right now. Please try again later.</p>;
  if (!form) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{form.intro}</p>
      {form.questions.map((q, i) => {
        const a = answers[q.id];
        return (
          <fieldset key={q.id} className="space-y-2">
            <legend className="text-sm font-medium">
              {i + 1}. {q.text}
            </legend>
            <div className="flex gap-2">
              {([true, false] as const).map((v) => (
                <label
                  key={String(v)}
                  className={`flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-lg border text-sm font-semibold ${
                    a?.yes === v ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary text-muted-foreground"
                  }`}
                >
                  <input
                    type="radio"
                    name={`q-${q.id}`}
                    className="sr-only"
                    checked={a?.yes === v}
                    onChange={() => setAnswers((p) => ({ ...p, [q.id]: { yes: v, note: p[q.id]?.note ?? "" } }))}
                  />
                  {v ? "Yes" : "No"}
                </label>
              ))}
            </div>
            {a?.yes ? (
              <input
                type="text"
                maxLength={300}
                placeholder="A few words (optional): what should your coach know?"
                value={a.note}
                onChange={(e) => setAnswers((p) => ({ ...p, [q.id]: { yes: true, note: e.target.value } }))}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm"
              />
            ) : null}
          </fieldset>
        );
      })}

      <label className="block space-y-1 text-sm">
        <span className="font-medium">If you are under 18: parent or guardian name</span>
        <input
          type="text"
          value={guardian}
          onChange={(e) => setGuardian(e.target.value)}
          placeholder="Optional"
          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm"
        />
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
        <span>{form.consent}</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} className="mt-1" />
        <span>{form.declaration}</span>
      </label>

      <p className="text-xs text-muted-foreground">{form.footer}</p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save my answers"}
      </button>
    </div>
  );
}
