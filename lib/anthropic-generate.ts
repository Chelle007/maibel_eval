import Anthropic from "@anthropic-ai/sdk";

export type AnthropicGenerateArgs = {
  apiKey: string;
  model: string;
  system: string;
  userText: string;
  /** Capped per model family (Haiku 4.5 supports up to 64k output). */
  maxTokens?: number;
};

const DEFAULT_MAX_OUT = 16384;
const ABSOLUTE_MAX_OUT = 64000;

export async function anthropicGenerateText(args: AnthropicGenerateArgs): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const client = new Anthropic({ apiKey: args.apiKey });
  const max_tokens = Math.min(args.maxTokens ?? DEFAULT_MAX_OUT, ABSOLUTE_MAX_OUT);
  const msg = await client.messages.create({
    model: args.model,
    max_tokens,
    system: args.system,
    messages: [{ role: "user", content: args.userText }],
  });
  const text = msg.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return {
    text,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
  };
}
