import type { TokenUsage } from "./types";

/** Approximate $ per 1M tokens (input, output). */
const PRICING: Record<string, { input: number; output: number }> = {
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
  "gemini-1.5-flash-8b": { input: 0.0375, output: 0.15 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "gemini-3-flash-preview": { input: 0.3, output: 2.5 },
  // Anthropic Claude 3.5 Haiku (approx. list pricing)
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4.0 },
  "claude-3-5-haiku-latest": { input: 0.8, output: 4.0 },
  // Claude Haiku 4.5 (approx. Anthropic list pricing)
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
};

const DEFAULT_PRICE = { input: 1.25, output: 5.0 };

export type TokenPrice = { input: number; output: number };

export function getTokenPricing(modelName: string): TokenPrice {
  return PRICING[modelName] ?? DEFAULT_PRICE;
}

export function computeTokenCostParts(
  promptTokenCount: number,
  candidatesTokenCount: number,
  modelName: string
): { input_cost_usd: number; output_cost_usd: number; total_cost_usd: number } {
  const price = getTokenPricing(modelName);
  const inputCostUsd = (promptTokenCount / 1_000_000) * price.input;
  const outputCostUsd = (candidatesTokenCount / 1_000_000) * price.output;
  return {
    input_cost_usd: inputCostUsd,
    output_cost_usd: outputCostUsd,
    total_cost_usd: inputCostUsd + outputCostUsd,
  };
}

export function computeTokenCost(
  promptTokenCount: number,
  candidatesTokenCount: number,
  modelName: string
): TokenUsage {
  const { total_cost_usd } = computeTokenCostParts(promptTokenCount, candidatesTokenCount, modelName);
  return {
    prompt_tokens: promptTokenCount,
    completion_tokens: candidatesTokenCount,
    total_tokens: promptTokenCount + candidatesTokenCount,
    cost_usd: Math.round(total_cost_usd * 1_000_000) / 1_000_000,
  };
}
