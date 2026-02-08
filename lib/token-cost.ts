import type { TokenUsage } from "./types";

/** Approximate $ per 1M tokens (input, output). Source: Google Gemini API pricing. */
const PRICING: Record<string, { input: number; output: number }> = {
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
  "gemini-1.5-flash-8b": { input: 0.0375, output: 0.15 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-3-pro-preview": { input: 2.0, output: 12.0 },
  "gemini-3-flash-preview": { input: 0.5, output: 2.0 },
};

const DEFAULT_PRICE = { input: 1.25, output: 5.0 };

export function computeTokenCost(
  promptTokenCount: number,
  candidatesTokenCount: number,
  modelName: string
): TokenUsage {
  const price = PRICING[modelName] ?? DEFAULT_PRICE;
  const costUsd =
    (promptTokenCount / 1_000_000) * price.input +
    (candidatesTokenCount / 1_000_000) * price.output;
  return {
    prompt_tokens: promptTokenCount,
    completion_tokens: candidatesTokenCount,
    total_tokens: promptTokenCount + candidatesTokenCount,
    cost_usd: Math.round(costUsd * 1_000_000) / 1_000_000,
  };
}
