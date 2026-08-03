# AI coach routing — redirect observability

There are two member-facing AI assistants: the general **AI Coach** (Messages
tab — training, recovery, readiness) and the **AI Nutrition Coach** (Nutrition
tab — daily/weekly meals, pre/post-training and match-day fuelling). Each has
its own system prompt (`lib/ai.ts`) telling it to give at most a brief,
general pointer on the other's topic, then redirect.

## What's recorded, and why

Both AI routes (`app/api/ai/chat/route.ts`, `app/api/ai/nutrition-coach/route.ts`)
detect a redirect with a simple regex against the assistant's own reply text —
`/nutrition (coach|tab)/i` for the general coach pointing to Nutrition,
`/\bmessages\b/i` for the Nutrition Coach pointing back. When it matches, a
`AiRedirectEventRecord` is written via `createAiRedirectEvent()` (`lib/db.ts`):

```ts
{ id: string, direction: "coach_to_nutrition" | "nutrition_to_coach", createdAt: string }
```

That's the entire record. No `userId`, no message text or excerpt, no other
identifiers — this exists to answer "how often does this happen" in
aggregate, not "which member asked what." Storage is append-only and capped
at 1000 rows (oldest dropped first), the same pattern `JobRunRecord` already
uses in this file.

## Important caveat

**This is a heuristic, not a classifier.** A substring match on the reply
text is a rough proxy for "did the coach redirect," not a confirmed signal —
it can miss a redirect phrased differently, or (rarely) fire on an unrelated
sentence that happens to contain the same words. Treat the counts as
directional (roughly how often, roughly which direction dominates), not as
an exact metric. It is not an analytics system and isn't meant to become one.

## How to review it

```bash
npm run ai-redirects
```

Prints total counts per direction and a per-ISO-week breakdown, read straight
from `data/db.json`. No dashboard, no UI — this is a manual, occasional check,
consistent with how this app already treats other low-volume internal data
(e.g. `contactInquiries`).

## What this can and can't tell you

It can tell you: roughly how often each coach hands a member to the other,
and whether that's trending up/down/flat over time.

It can't tell you: whether the drink/hydration question overlap between the
two coaches (both can answer it directly — no redirect happens either way)
is harmless or confusing in practice. That's a structurally different
question this signal doesn't cover, since no redirect event fires when both
coaches are equally capable of answering.
