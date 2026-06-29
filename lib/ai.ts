// AI provider integration point.
//
// No real AI provider is wired up in this app yet. The functions below are
// honest stubs: they return a clear "not configured" result rather than
// fabricating AI output.
//
// To enable real AI-assisted features (example shown for the Anthropic API,
// but any provider follows the same shape):
//
//   1. npm install @anthropic-ai/sdk
//   2. Set ANTHROPIC_API_KEY in .env.local
//   3. Replace the bodies of generateCoachSummary() and draftReply() below
//      with real calls to the Anthropic Messages API, passing in the
//      member/programme/profile/recovery context already available from
//      lib/db.ts.
//   4. Treat AI output as a draft for a human to review, not as something
//      sent to a member automatically — especially for messaging.

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export const AI_NOT_CONFIGURED_MESSAGE =
  "AI assistant is not configured yet. An Anthropic API key is required to enable this.";

export interface CoachSummaryContext {
  memberId: string;
}

export interface DraftReplyContext {
  memberId: string;
  latestMemberMessage: string | null;
}

export async function generateCoachSummary(
  _context: CoachSummaryContext
): Promise<string> {
  if (!isAiConfigured()) return AI_NOT_CONFIGURED_MESSAGE;

  return AI_NOT_CONFIGURED_MESSAGE;
}

export async function draftReply(_context: DraftReplyContext): Promise<string> {
  if (!isAiConfigured()) return AI_NOT_CONFIGURED_MESSAGE;

  return AI_NOT_CONFIGURED_MESSAGE;
}
