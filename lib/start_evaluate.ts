import { evaluateOne } from "./evaluator";
import { callEvrenApi } from "./evren";
import { loadEvaluatorSystemPrompt } from "./prompts";
import { fetchSheetRows, sheetRowToTestCase } from "./sheet";
import type { EvaluationResult, TestCase } from "./types";

export interface StartEvaluateParams {
  /** System prompt for evaluator (and later summarizer). If omitted, loads evaluator prompt from content/prompts. */
  systemPrompt?: string;
  /** Evren model API base URL (POST with test case input, returns evren_response + detected_flags; we store as detected_states). */
  evrenModelApiUrl: string;
  /** Google Sheet link (must be published to web or publicly viewable for CSV export). */
  googleSheetLink: string;
  /** Gemini API key. If omitted, uses process.env.GEMINI_API_KEY. */
  apiKey?: string;
  /** Gemini model name for evaluator. Default "gemini-2.5-flash". */
  modelName?: string;
}

/**
 * Fetch test cases from sheet (first maxRows), call Evren API for each, then evaluate with Gemini.
 * Returns list of evaluation results.
 */
export async function startEvaluate(params: StartEvaluateParams): Promise<EvaluationResult[]> {
  const {
    systemPrompt,
    evrenModelApiUrl,
    googleSheetLink,
    modelName = "gemini-2.5-flash",
  } = params;

  const apiKey = params.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing apiKey or GEMINI_API_KEY");

  const resolvedSystemPrompt = systemPrompt ?? loadEvaluatorSystemPrompt();
  const rows = await fetchSheetRows(googleSheetLink);
  const results: EvaluationResult[] = [];

  for (const row of rows) {
    const testCase = sheetRowToTestCase(row);
    if (!testCase.input_message?.trim()) continue;

    const evrenOutput = await callEvrenApi(evrenModelApiUrl, testCase);
    const result = await evaluateOne(
      testCase,
      evrenOutput,
      apiKey,
      modelName,
      resolvedSystemPrompt
    );
    results.push(result);
  }

  return results;
}
