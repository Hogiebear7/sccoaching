import { PARQ_QUESTIONS, parqIsCurrent, type ParqRecord } from "@/lib/parq";

// What a coach sees of a gym member's PAR-Q on the member page. Only the Yes answers, with the member's own words. Callers MUST have checked the staff
// member may see health details (UserRecord.hideMemberHealth) and that the viewer is in the member's gym.
export function ParqSummary({ parq }: { parq: ParqRecord | null | undefined }) {
  if (!parq) {
    return (
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Health check (PAR-Q)</h3>
        <p className="mt-3 text-sm text-muted-foreground">Not completed yet.</p>
      </div>
    );
  }
  const yes = PARQ_QUESTIONS.filter((q) => parq.answers[q.id]?.yes);
  const date = new Date(parq.answeredAt).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="panel p-6">
      <h3 className="text-lg font-semibold">Health check (PAR-Q)</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Completed {date}
        {parqIsCurrent(parq) ? "" : " (older than 12 months, due again)"}
        {parq.guardianName ? `. Completed with parent or guardian: ${parq.guardianName}` : ""}
      </p>
      {yes.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No to every question.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {yes.map((q) => (
            <li key={q.id}>
              <span className="font-medium">Yes: </span>
              {q.text}
              {parq.answers[q.id].note ? <span className="text-muted-foreground"> Their note: &ldquo;{parq.answers[q.id].note}&rdquo;</span> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">A screening record, not medical clearance. A Yes means have a chat before training.</p>
    </div>
  );
}
