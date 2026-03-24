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

/** Build the user message (INPUT DATA) for the evaluator. Always one format: test case metadata + CONVERSATION (turns of user input + Evren response + detected flags). */
export function buildEvaluatorUserMessage(
  testCase: TestCase,
  evrenOutputOrOutputs: EvrenOutput | EvrenOutput[]
): string {
  const tc = testCase;
  const outputs = Array.isArray(evrenOutputOrOutputs) ? evrenOutputOrOutputs : [evrenOutputOrOutputs];
  const userMessages: string[] =
    tc.type === "multi_turn" && Array.isArray(tc.turns) && tc.turns.length > 0
      ? tc.turns.map((s) => String(s ?? "").trim())
      : [tc.input_message?.trim() ?? ""];
  const sections: string[] = [];

  sections.push("=== TEST CASE ===");
  sections.push(`test_case_id: ${tc.test_case_id}`);
  if (tc.img_url) sections.push(`Img url: ${tc.img_url}`);
  sections.push(`Expected states: ${tc.expected_state}`);
  sections.push(`Expected behavior: ${tc.expected_behavior}`);
  if (tc.forbidden) sections.push(`Forbidden: ${tc.forbidden}`);
  if (tc.notes) sections.push(`Notes: ${tc.notes}`);

  sections.push("");
  sections.push("=== CONVERSATION ===");
  sections.push("(Evaluate every turn and the whole exchange.)");
  for (let i = 0; i < outputs.length; i++) {
    const n = i + 1;
    const userMsg = userMessages[i] ?? "(no user message)";
    const out = outputs[i] ?? { evren_response: "", detected_states: "" };
    const responseText = Array.isArray(out.evren_response) ? out.evren_response.join("\n") : out.evren_response;
    sections.push(`--- Turn ${n} ---`);
    sections.push(`User: ${userMsg}`);
    sections.push(`Evren response: ${responseText}`);
    sections.push(`Detected flags: ${out.detected_states}`);
    sections.push("");
  }

  return sections.join("\n");
}
