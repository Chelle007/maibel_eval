/** Default model for evaluator, summarizer, comparator, and related LLM calls (Anthropic Messages API). */
export const DEFAULT_EVAL_LLM_MODEL = "claude-haiku-4-5-20251001";

/**
 * Normalize user-entered shorthand model names to an Anthropic model id.
 * This prevents silent 404s when the UI stores shorthand like "haiku-4-5-20251001".
 */
export function normalizeAnthropicModelName(input: string | null | undefined): string | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  if (raw.startsWith("claude-")) return raw;

  // Common shorthand: drop leading "claude-"
  if (raw === "haiku-4-5-20251001") return "claude-haiku-4-5-20251001";

  // Best-effort: if user enters "haiku-..." assume "claude-haiku-..."
  if (raw.startsWith("haiku-")) return `claude-${raw}`;

  return raw;
}
