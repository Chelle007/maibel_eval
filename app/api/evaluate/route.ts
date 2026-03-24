import { NextResponse } from "next/server";
import { evaluateOne } from "@/lib/evaluator";
import type { EvaluateInput } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY environment variable" },
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

    const modelName = body.model_name ?? "gemini-3-flash-preview";
    const systemPrompt = body.system_prompt;
    const result = await evaluateOne(
      testCase,
      hasOutputs ? evrenOutputs : evrenOutput!,
      apiKey,
      modelName,
      systemPrompt
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
