import { NextResponse } from "next/server";
import { callEvrenApi } from "@/lib/evren";
import { evaluateOne } from "@/lib/evaluator";
import type { TestCase } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY environment variable" },
        { status: 500 }
      );
    }

    const body = (await request.json()) as {
      test_case: TestCase;
      evren_model_api_url: string;
      model_name?: string;
      system_prompt?: string;
    };

    const { test_case: testCase, evren_model_api_url: evrenModelApiUrl } = body;

    if (!testCase?.input_message?.trim()) {
      return NextResponse.json(
        { error: "Request body must include 'test_case' with input_message." },
        { status: 400 }
      );
    }

    if (!evrenModelApiUrl?.trim()) {
      return NextResponse.json(
        { error: "Request body must include 'evren_model_api_url'." },
        { status: 400 }
      );
    }

    const evrenOutput = await callEvrenApi(evrenModelApiUrl, testCase);
    const modelName = body.model_name ?? "gemini-1.5-pro";
    const systemPrompt = body.system_prompt;
    const result = await evaluateOne(
      testCase,
      evrenOutput,
      apiKey,
      modelName,
      systemPrompt
    );
    return NextResponse.json({
      ...result,
      evren_response: evrenOutput.evren_response,
      detected_flags: evrenOutput.detected_flags,
    });
  } catch (err) {
    console.error("Evaluate-one API error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Evaluate one failed",
      },
      { status: 500 }
    );
  }
}
