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
    const { test_case: testCase, evren_output: evrenOutput } = body;

    if (!testCase || !evrenOutput) {
      return NextResponse.json(
        {
          error:
            "Request body must include 'test_case' and 'evren_output'. See lib/types.ts for shape.",
        },
        { status: 400 }
      );
    }

    const modelName = body.model_name ?? "gemini-2.5-flash";
    const systemPrompt = body.system_prompt;
    const result = await evaluateOne(testCase, evrenOutput, apiKey, modelName, systemPrompt);
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
