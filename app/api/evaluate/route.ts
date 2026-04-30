import { NextResponse } from "next/server";
import { evaluateOne } from "@/lib/evaluator";
import { loadContextPack } from "@/lib/context-pack";
import type { EvaluateInput } from "@/lib/types";
import { getAnthropicEvalApiKey } from "@/lib/eval-llm-env";
import { DEFAULT_EVAL_LLM_MODEL } from "@/lib/eval-llm-defaults";

export async function POST(request: Request) {
  try {
    const apiKey = getAnthropicEvalApiKey();
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing ANTHROPIC_API_KEY or CLAUDE_API_KEY environment variable" },
        { status: 500 }
      );
    }

    const body = (await request.json()) as Partial<EvaluateInput> & {
      model_name?: string;
      system_prompt?: string;
    };
    const { test_case: testCase, evren_output: evrenOutput, evren_outputs: evrenOutputs } = body;

    if (!testCase) {
      return NextResponse.json(
        { error: "Request body must include 'test_case'. See lib/types.ts for shape." },
        { status: 400 }
      );
    }
    const hasOutputs = Array.isArray(evrenOutputs) && evrenOutputs.length > 0;
    if (!hasOutputs && !evrenOutput) {
      return NextResponse.json(
        {
          error:
            "Request body must include 'evren_output' (single) or 'evren_outputs' (multi-turn). See lib/types.ts.",
        },
        { status: 400 }
      );
    }

    const modelName = body.model_name ?? DEFAULT_EVAL_LLM_MODEL;
    const systemPrompt = body.system_prompt;
    const contextPack = loadContextPack({
      purpose: "evaluator",
      query: `${testCase.test_case_id}\n${testCase.expected_state ?? ""}\n${testCase.expected_behavior ?? ""}\n${testCase.forbidden ?? ""}`,
    });
    const result = await evaluateOne(
      testCase,
      hasOutputs ? evrenOutputs : evrenOutput!,
      apiKey,
      modelName,
      systemPrompt,
      { text: contextPack.text, bundleId: contextPack.bundleId }
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("Evaluate API error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Evaluation failed",
      },
      { status: 500 }
    );
  }
}
