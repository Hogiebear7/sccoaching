import type { ProfileRecord } from "@/lib/profile-schema";
import {
  ALLERGEN_OPTIONS,
  DIETARY_PREFERENCE_OPTIONS,
  INTOLERANCE_OPTIONS,
} from "@/lib/profile-options";

const LABEL = new Map<string, string>(
  [...ALLERGEN_OPTIONS, ...INTOLERANCE_OPTIONS].map((o) => [o.value, o.label])
);

function labelsFor(keys: string[] | undefined): string[] {
  return (keys ?? []).map((k) => LABEL.get(k) ?? k);
}

// Read-only dietary summary used on the staff member-detail page (and reusable
// anywhere a compact view is needed). Renders a clean empty state.
export function DietaryRequirementsSummary({ profile }: { profile: ProfileRecord }) {
  const preference = profile.dietaryPreference ?? "standard";
  const preferenceLabel =
    DIETARY_PREFERENCE_OPTIONS.find((o) => o.value === preference)?.label ?? "No preference";
  const allergies = labelsFor(profile.allergies);
  const intolerances = labelsFor(profile.intolerancesOrMedical);
  const notes = profile.dietaryNotes ?? null;

  const hasAny =
    preference !== "standard" || allergies.length > 0 || intolerances.length > 0 || !!notes;

  return (
    <div className="panel p-6">
      <h3 className="text-lg font-semibold">Dietary requirements</h3>
      {!hasAny ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No dietary requirements set — treated as no preference with no exclusions.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          <Row label="Preference" values={[preferenceLabel]} />
          <Row label="Allergies" values={allergies} tone="warn" empty="None" />
          <Row label="Intolerances / medical" values={intolerances} tone="warn" empty="None" />
          {notes ? (
            <div className="grid gap-1 sm:grid-cols-[180px_minmax(0,1fr)]">
              <span className="text-sm text-muted-foreground">Notes</span>
              <span className="text-sm">{notes}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  values,
  tone = "neutral",
  empty,
}: {
  label: string;
  values: string[];
  tone?: "neutral" | "warn";
  empty?: string;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-start">
      <span className="text-sm text-muted-foreground">{label}</span>
      {values.length === 0 ? (
        <span className="text-sm text-muted-foreground/60">{empty ?? "—"}</span>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                tone === "warn"
                  ? "bg-gold/[0.12] text-gold"
                  : "bg-white/[0.04] text-foreground"
              }`}
            >
              {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
