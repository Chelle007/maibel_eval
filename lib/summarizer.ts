import { GoogleGenerativeAI } from "@google/generative-ai";
import { loadSummarizerSystemPrompt } from "./prompts";
import { computeTokenCost } from "./token-cost";
import type { TestCase, EvrenOutput, EvaluationResult } from "./types";

/** One "Rich Test Case Report" sent to the summarizer (matches summarizer_system_prompt.txt). */
export interface RichTestCaseReport {
  specs: {
    input: string;
    expected_behavior: string;
    forbidden?: string;
    expected_states: string;
  };
  results: {
    evren_response: string;
    detected_states: string;
  };
  evaluator_verdict: {
    success: boolean;
    score: number;
    reason: string;
  };
}

/** Build a single rich report from test case + Evren output + evaluation result. */
export function buildRichReport(
  testCase: TestCase,
  evrenOutput: EvrenOutput,
  evalResult: EvaluationResult
): RichTestCaseReport {
  return {
    specs: {
      input: testCase.input_message,
      expected_behavior: testCase.expected_behavior,
      ...(testCase.forbidden && { forbidden: testCase.forbidden }),
      expected_states: testCase.expected_states,
    },
    results: {
      evren_response: evrenOutput.evren_response,
      detected_states: evrenOutput.detected_states,
    },
    evaluator_verdict: {
      success: evalResult.success,
      score: evalResult.score,
      reason: evalResult.reason ?? "",
    },
  };
}

const DEFAULT_MODEL = "gemini-2.5-flash";

export interface SummarizerResult {
  summary: string;
  cost_usd: number;
}

/** Run the summarizer on all rich reports; returns the validation report text and cost. */
export async function runSummarizer(
  apiKey: string,
  richReports: RichTestCaseReport[],
  modelName: string = DEFAULT_MODEL,
  systemPrompt?: string
): Promise<SummarizerResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const systemInstruction = systemPrompt ?? loadSummarizerSystemPrompt();
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction,
  });

  const userMessage = JSON.stringify(richReports, null, 2);

  const result = await model.generateContent(userMessage);
  const response = result.response;
  const summary = response.text();

  const usage = response.usageMetadata;
  const token_usage = usage
    ? computeTokenCost(
        usage.promptTokenCount ?? 0,
        usage.candidatesTokenCount ?? 0,
        modelName
      )
    : null;

  const cost_usd = token_usage?.cost_usd ?? 0;

  return { summary, cost_usd };
}
