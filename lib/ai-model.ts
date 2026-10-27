// The model every AI call uses. Env-overridable so the model can be changed without a code change. It must be a model whose price is known to
// lib/ai-usage.ts: with allowances enforced, a call to an unpriced model is refused rather than reserved at a guessed rate (see lib/ai-metering.ts).
export const DEFAULT_COACH_MODEL = "claude-opus-4-8";

export function configuredAiModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_COACH_MODEL;
}
