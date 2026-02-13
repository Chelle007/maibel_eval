import { readFileSync } from "fs";
import path from "path";
import type { TestCase, EvrenOutput } from "./types";

const PROMPTS_DIR = path.join(process.cwd(), "content", "prompts");

function readPrompt(filename: string): string {
  return readFileSync(path.join(PROMPTS_DIR, filename), "utf-8").trim();
}

/** Load base system prompt (Evren persona + flag logic). */
export function loadBaseSystemPrompt(): string {
  return readPrompt("base_system_prompt.txt");
}

/** Load evaluator system prompt and inject base prompt. */
export function loadEvaluatorSystemPrompt(): string {
  const content = readPrompt("evaluator_system_prompt.txt");
  const base = loadBaseSystemPrompt();
  return content.replace(/\{base_system_prompt\}/g, base);
}

/** Load summarizer system prompt and inject base prompt. */
export function loadSummarizerSystemPrompt(): string {
  const content = readPrompt("summarizer_system_prompt.txt");
  const base = loadBaseSystemPrompt();
  return content.replace(/\{base_system_prompt\}/g, base);
}

/** Build the user message (INPUT DATA) for the evaluator from test case + Evren output. */
export function buildEvaluatorUserMessage(testCase: TestCase, evrenOutput: EvrenOutput): string {
  const tc = testCase;
  const out = evrenOutput;
  const sections: string[] = [];

  sections.push("=== TEST CASE ===");
  sections.push(`test_case_id: ${tc.test_case_id}`);
  sections.push(`Input message: ${tc.input_message}`);
  if (tc.img_url) sections.push(`Img url: ${tc.img_url}`);
  if (tc.context) sections.push(`Context: ${tc.context}`);
  sections.push(`Expected states: ${tc.expected_states}`);
  sections.push(`Expected behavior: ${tc.expected_behavior}`);
  if (tc.forbidden) sections.push(`Forbidden: ${tc.forbidden}`);

  sections.push("");
  sections.push("=== EVREN OUTPUT ===");
  sections.push(`Evren response: ${out.evren_response}`);
  sections.push(`Detected states: ${out.detected_states}`);

  return sections.join("\n");
}
