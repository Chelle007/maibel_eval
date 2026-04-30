import { NextResponse } from "next/server";
import { anthropicGenerateText } from "@/lib/anthropic-generate";
import { getAnthropicEvalApiKey } from "@/lib/eval-llm-env";
import { DEFAULT_EVAL_LLM_MODEL } from "@/lib/eval-llm-defaults";

/** Legacy path name; calls the configured eval LLM (Anthropic Haiku 4.5 by default). */
export async function POST(request: Request) {
  try {
    const { prompt } = (await request.json()) as { prompt?: string };
    const apiKey = getAnthropicEvalApiKey();

    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing ANTHROPIC_API_KEY or CLAUDE_API_KEY environment variable" },
        { status: 500 }
      );
    }

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Request body must include a string 'prompt'" },
        { status: 400 }
      );
    }

    const { text } = await anthropicGenerateText({
      apiKey,
      model: DEFAULT_EVAL_LLM_MODEL,
      system: "You are a helpful assistant. Answer concisely.",
      userText: prompt,
    });

    return NextResponse.json({ text });
  } catch (err) {
    console.error("Eval LLM API error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "LLM request failed" },
      { status: 500 }
    );
  }
}
