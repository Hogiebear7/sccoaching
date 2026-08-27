// Parses the AI Nutrition Coach's structured target-change marker out of a
// chat reply. Deliberately dependency-free (no DB, no AI SDK) so it can be
// imported both server-side (the chat route, to know whether to persist an
// AiMessageRecord's proposal for the "Apply this target" button) and
// client-side in the chat UI — and mirrored byte-for-byte into
// sc-coaching-mobile's own copy of this file, same convention as every
// other web/mobile-shared type in this app.
//
// The marker is instructed into the model via NUTRITION_COACH_SYSTEM_PROMPT
// (lib/ai.ts) as the literal last line of a reply proposing a new target:
//   [[PROPOSE_TARGET calories=2400 proteinG=180 carbsG=250 fatG=70]]
// It's never meant to reach the member's eyes — extractTargetProposal
// strips it from the displayed text.

export interface TargetProposal {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

const PROPOSAL_RE = /\[\[PROPOSE_TARGET\s+calories=(\d+)\s+proteinG=(\d+)\s+carbsG=(\d+)\s+fatG=(\d+)\]\]\s*$/;

export function extractTargetProposal(content: string): {
  cleanText: string;
  proposal: TargetProposal | null;
} {
  const match = content.match(PROPOSAL_RE);
  if (!match) return { cleanText: content, proposal: null };

  const [, calories, proteinG, carbsG, fatG] = match;
  return {
    cleanText: content.slice(0, match.index).trimEnd(),
    proposal: {
      calories: Number(calories),
      proteinG: Number(proteinG),
      carbsG: Number(carbsG),
      fatG: Number(fatG),
    },
  };
}
