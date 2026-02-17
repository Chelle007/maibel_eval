import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  loadEvaluatorSystemPrompt,
  buildEvaluatorUserMessage,
} from "./prompts";
import { computeTokenCost } from "./token-cost";
import type { TestCase, EvrenOutput, EvaluationResult } from "./types";

/** Extract JSON from model text (handles markdown code blocks). */
function extractJson(text: string): string {
  const trimmed = text.trim();
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1].trim();
  return trimmed;
}

/** Escape control characters inside JSON string literals so JSON.parse accepts the string. */
function sanitizeJsonStringLiterals(jsonStr: string): string {
  let result = "";
  let i = 0;
  const len = jsonStr.length;
  while (i < len) {
    const c = jsonStr[i];
    if (c === '"') {
      result += c;
      i++;
      while (i < len) {
        const d = jsonStr[i];
        if (d === "\\") {
          result += jsonStr.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (d === '"') {
          result += d;
          i++;
          break;
        }
        if (d >= "\u0000" && d <= "\u001f") {
          const code = d.charCodeAt(0);
          if (code === 0x0a) result += "\\n";
          else if (code === 0x0d) result += "\\r";
          else if (code === 0x09) result += "\\t";
          else result += "\\u" + code.toString(16).padStart(4, "0");
          i++;
          continue;
        }
        result += d;
        i++;
      }
      continue;
    }
    result += c;
    i++;
  }
  return result;
}

const DEFAULT_MODEL = "gemini-2.5-flash";

/** Run evaluator on one test case + Evren output; returns parsed evaluation result. */
export async function evaluateOne(
  testCase: TestCase,
  evrenOutput: EvrenOutput,
  apiKey: string,
  modelName: string = DEFAULT_MODEL,
  systemPrompt?: string
): Promise<EvaluationResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const systemInstruction = systemPrompt ?? loadEvaluatorSystemPrompt();
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction,
  });

  const userMessage = buildEvaluatorUserMessage(testCase, evrenOutput);
  const result = await model.generateContent(userMessage);
  const response = result.response;
  const text = response.text();

  const usage = response.usageMetadata;
  const token_usage = usage
    ? computeTokenCost(
        usage.promptTokenCount ?? 0,
        usage.candidatesTokenCount ?? 0,
        modelName
      )
    : undefined;

  const jsonStr = extractJson(text);
  const sanitized = sanitizeJsonStringLiterals(jsonStr);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(sanitized) as Record<string, unknown>;
  } catch (parseErr) {
    const message = parseErr instanceof Error ? parseErr.message : "Invalid JSON";
    console.error("[evaluator] JSON parse failed:", message, "raw length:", sanitized.length);
    return {
      test_case_id: testCase.test_case_id,
      success: false,
      score: 0,
      flags_detected: "",
      reason: `Evaluator returned invalid JSON: ${message}`,
      ...(token_usage && { token_usage }),
    };
  }

  // Normalize success (prompt says "true/false" string)
  const success =
    parsed.success === true ||
    parsed.success === "true" ||
    String(parsed.success).toLowerCase() === "true";
  const score = typeof parsed.score === "number" ? parsed.score : Number(parsed.score) || 0;

  return {
    test_case_id: String(parsed.test_case_id ?? testCase.test_case_id),
    success,
    score,
    flags_detected: String(parsed.flags_detected ?? ""),
    reason: String(parsed.reason ?? ""),
    ...(token_usage && { token_usage }),
  };
}
