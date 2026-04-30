/**
 * API key for Anthropic (evaluator / summarizer / comparison LLM).
 * Prefer ANTHROPIC_API_KEY; CLAUDE_API_KEY is accepted for older local setups.
 */
export function getAnthropicEvalApiKey(): string | undefined {
  const a = process.env.ANTHROPIC_API_KEY?.trim();
  if (a) return a;
  return process.env.CLAUDE_API_KEY?.trim();
}
